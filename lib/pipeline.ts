import { runDocumentIngestion, type UploadedFile } from "./document-ingest";
import { runGeminiAnalysis } from "./gemini-ai";
import { runMatching } from "./matching";
import { evaluateDocumentQuality } from "./document-quality";
import { detectMissingFields, extractEntities, scoreComplexity } from "./mock-ai";
import { combineExtractedFields } from "./reconcile";
import { underwriterRegistry } from "./underwriters";
import type {
  ApplicationInput,
  AuditEvent,
  CaseStatus,
  ComplexityResult,
  DecisionPath,
  DocumentExtraction,
  IngestionResult,
  ReconciliationLog,
  UnderwriterEvaluation,
  UnderwritingCase
} from "./types";

export const MIN_AUTO_ASSIGN_CONFIDENCE = 0.75;

export function passesAutoAssignmentConfidence(documentConfidence: number | null | undefined, complexityConfidence: number) {
  return (documentConfidence == null || documentConfidence >= MIN_AUTO_ASSIGN_CONFIDENCE) && complexityConfidence >= MIN_AUTO_ASSIGN_CONFIDENCE;
}

// Two ways documents reach the pipeline:
//   files       -- raw uploads to OCR + auto-merge here (direct API callers, the offline seed).
//   extractions -- already OCR'd by /api/documents/extract and reconciled by the submitter on the
//                  Submit page; the pipeline trusts `input` as-is and only records what happened.
export type IngestOptions = {
  files?: UploadedFile[];
  extractions?: DocumentExtraction[];
  reconciliation?: ReconciliationLog | null;
  documentSessionId?: string;
};

function id(prefix: string) {
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function timestamp() {
  return new Date().toISOString();
}

function audit(caseId: string, actor: AuditEvent["actor"], action: string, detail: string): AuditEvent {
  return { id: id("evt"), caseId, actor, action, detail, createdAt: timestamp() };
}

// Phase 2, steps 3-8 of the flow: Data Ingestion (the ApplicationInput itself is the ingested
// payload, aggregated client-side from the intake form) -> Complexity Classifier + NER -> Filter
// Node -> Optimization Node -> consolidated STP / Manual / Escalated decision.
export async function runIntakePipeline(input: ApplicationInput, opts: IngestOptions = {}): Promise<UnderwritingCase> {
  const caseId = id("APP");
  const now = timestamp();
  const events: AuditEvent[] = [audit(caseId, "system", "Case submitted", "Status set to PENDING; entered Data Ingestion Engine.")];

  // Step 2 -- Document Ingestion Engine.
  let workingInput = input;
  let ingestion: IngestionResult | null = null;
  let documentQuality = null as ReturnType<typeof evaluateDocumentQuality> | null;

  if (opts.extractions?.length) {
    // Submitter already reconciled the document data on the Submit page: trust `input`.
    const recon = opts.reconciliation ?? null;
    ingestion = {
      extractions: opts.extractions,
      filledFields: [],
      overriddenFields: recon?.applied ?? [],
      appendedToMedicalHistory: recon?.addedToMedicalHistory ?? false,
      mode: "reconciled",
      reconciliation: recon
      ,documentSessionId: opts.documentSessionId ?? opts.extractions[0].documentSessionId
    };
    const roster = opts.extractions.map((e) => `${e.fileName} [${e.kind}, ${e.provider}]`).join("; ");
    events.push(
      audit(caseId, "ai", "Document Ingestion Engine", `OCR ran at upload for ${opts.extractions.length} document(s): ${roster}. Submitter reconciled the fields before intake.`)
    );
    for (const e of opts.extractions) {
      events.push(audit(caseId, "ai", `Extracted from ${e.fileName}`, [e.summary, ...e.warnings].join(" ")));
    }
    for (const a of recon?.applied ?? []) {
      events.push(audit(caseId, "human", "Field aligned to document", `${a.field}: "${a.from}" -> "${a.to}" (source: ${a.source}).`));
    }
    for (const k of recon?.keptOwn ?? []) {
      events.push(
        audit(caseId, "human", "Document mismatch acknowledged", `${k.field}: kept "${k.userValue}" over document "${k.documentValue}" (source: ${k.source}).`)
      );
    }
    if (recon?.addedToMedicalHistory) {
      events.push(audit(caseId, "human", "Document findings merged", "Submitter added document medical findings to the medical history."));
    }
    if (recon?.addedToDisclosures) {
      events.push(audit(caseId, "human", "Document findings merged", "Submitter added document notes to the disclosures."));
    }
  } else if (opts.files?.length) {
    // Direct-API / seed path: OCR + auto-merge (document wins), every change recorded.
    const merged = await runDocumentIngestion(input, opts.files);
    workingInput = merged.input;
    ingestion = merged.ingestion;
    ingestion.documentSessionId = opts.documentSessionId ?? ingestion.extractions[0]?.documentSessionId;
    const roster = ingestion.extractions.map((e) => `${e.fileName} [${e.kind}, ${e.provider}]`).join("; ");
    events.push(audit(caseId, "ai", "Document Ingestion Engine", `Parsed ${ingestion.extractions.length} document(s): ${roster}.`));
    for (const e of ingestion.extractions) {
      events.push(audit(caseId, "ai", `Extracted from ${e.fileName}`, [e.summary, ...e.warnings].join(" ")));
    }
    if (ingestion.filledFields.length) {
      events.push(audit(caseId, "ai", "Fields auto-filled from documents", `Populated empty field(s): ${ingestion.filledFields.join(", ")}.`));
    }
    for (const o of ingestion.overriddenFields) {
      events.push(audit(caseId, "ai", "Field overridden from document", `${o.field}: "${o.from}" -> "${o.to}" (source: ${o.source}).`));
    }
  }

  // New document-quality gate. It runs after ingestion, before final routing, and is intentionally
  // independent from underwriting risk scoring. Applications without an uploaded extraction keep
  // the legacy behavior; applications with claim/medical evidence must pass this gate before they
  // can be auto-assigned.
  if (ingestion?.extractions.length) {
    const engineUsed = ingestion.extractions.every((e) => e.provider === "gemini") ? "gemini" : "deterministic-fallback";
    documentQuality = evaluateDocumentQuality(ingestion.extractions, engineUsed);
    events.push(
      audit(
        caseId,
        "ai",
        `Document Quality Evaluator (${documentQuality.engineUsed})`,
        `Score ${documentQuality.score}/10 — ${documentQuality.validationStatus}. Profile: ${documentQuality.detectedMedicalProfile}. ${
          documentQuality.contradictions.length ? `Issues: ${documentQuality.contradictions.map((item) => `${item.code}: ${item.message} (-${item.penalty})`).join(" ")}` : "Required evidence is coherent."
        }`
      )
    );
  }

  const clinicalFields = ingestion?.extractions.length ? combineExtractedFields(ingestion.extractions.map((e) => e.fields)) : undefined;

  const { missingFields, followUpMessage } = detectMissingFields(workingInput);
  events.push(
    audit(
      caseId,
      "ai",
      "Completeness check",
      missingFields.length ? `${missingFields.length} missing field(s) identified: ${missingFields.join(", ")}.` : "Application package is complete."
    )
  );

  let provider: "gemini" | "fallback";
  let complexity;
  let ner;
  try {
    const analysis = await runGeminiAnalysis(workingInput, clinicalFields);
    complexity = analysis.complexity;
    ner = analysis.ner;
    provider = "gemini";
    events.push(audit(caseId, "ai", "Complexity Classifier + NER (Gemini)", `${complexity.reasonCode} Specialties required: ${ner.specialtiesRequired.join(", ") || "none"}.`));
  } catch (error) {
    ner = extractEntities(workingInput, clinicalFields);
    complexity = scoreComplexity(workingInput, ner, clinicalFields);
    provider = "fallback";
    events.push(
      audit(
        caseId,
        "system",
        "Gemini unavailable -- deterministic fallback used",
        error instanceof Error ? error.message : "Unknown error calling Gemini."
      )
    );
    events.push(audit(caseId, "ai", "Complexity Classifier + NER (rule-based fallback)", `${complexity.reasonCode} Specialties required: ${ner.specialtiesRequired.join(", ") || "none"}.`));
  }

  if (documentQuality && (documentQuality.score < 8 || documentQuality.validationStatus === "FAILED" || documentQuality.semanticMatchScore < 0.5 || documentQuality.reasonCodes.includes("MISSING_REQUIRED_FIELDS"))) {
    complexity = {
      ...complexity,
      complexityConfidence: Math.min(complexity.complexityConfidence, 0.45),
      complexityEvidence: [...complexity.complexityEvidence, "Low confidence: document quality or required clinical evidence is insufficient."]
    };
  }

  const match = await runMatching(caseId, workingInput.sumAssured, ner, complexity);
  events.push(
    audit(
      caseId,
      "ai",
      `Filter Node + Optimization Node (${match.engine})`,
      `${match.evaluations.filter((e) => e.eligible).length}/${match.evaluations.length} underwriters eligible. ${match.rationale}`
    )
  );

  const { status, decisionPath, assigneeId, poolQueueReason } = decide(complexity, match.chosenUnderwriterId, match.evaluations, documentQuality);
  if (documentQuality?.validationStatus === "FAILED") {
    events.push(
      audit(
        caseId,
        "system",
        "Document validation blocked assignment",
        `Document score ${documentQuality.score}/10 is below the 8/10 threshold. Routed to Pool Queue. ${documentQuality.missingFields.length ? `Missing: ${documentQuality.missingFields.join(", ")}.` : ""}`
      )
    );
  }
  if (poolQueueReason === "INSUFFICIENT_EVALUATION_CONFIDENCE") {
    events.push(audit(caseId, "system", "Confidence gate blocked auto-assignment", `Required confidence is at least ${MIN_AUTO_ASSIGN_CONFIDENCE}. Document confidence: ${documentQuality?.evaluatorConfidence ?? "n/a"}; complexity confidence: ${complexity.complexityConfidence}.`));
  }
  if (poolQueueReason === "POLICY_FAILURE" || poolQueueReason === "NO_ELIGIBLE_UNDERWRITER") {
    events.push(audit(caseId, "system", "Eligibility gate blocked assignment", `Pool Queue reason: ${poolQueueReason}.`));
  }
  events.push(audit(caseId, "system", decisionLogAction(decisionPath), decisionLogDetail(decisionPath, assigneeId, poolQueueReason)));

  return {
    ...workingInput,
    id: caseId,
    status,
    decisionPath,
    missingFields,
    followUpMessage,
    complexity,
    ner,
    match,
    assigneeId,
    poolQueueReason,
    provider,
    documentExtractions: ingestion?.extractions ?? [],
    ingestion: ingestion && ingestion.extractions.length ? ingestion : null,
    documentQuality,
    documentSessionId: ingestion?.documentSessionId ?? opts.documentSessionId,
    createdAt: now,
    updatedAt: timestamp(),
    audit: events
  };
}

function decide(
  complexity: ComplexityResult,
  chosenUnderwriterId: string | null,
  evaluations: UnderwriterEvaluation[],
  documentQuality: ReturnType<typeof evaluateDocumentQuality> | null
): { status: CaseStatus; decisionPath: DecisionPath; assigneeId: string | null; poolQueueReason: UnderwritingCase["poolQueueReason"] } {
  if (!complexity) return { status: "POOL_QUEUE", decisionPath: "ESCALATED", assigneeId: null, poolQueueReason: "INSUFFICIENT_EVALUATION_CONFIDENCE" };
  if (documentQuality?.validationStatus === "FAILED") {
    return {
      status: "POOL_QUEUE",
      decisionPath: "POOL_QUEUE",
      assigneeId: null,
      poolQueueReason: documentQuality.readabilityScore === 0
        ? "DOCUMENT_UNREADABLE"
        : documentQuality.reasonCodes.includes("SEMANTIC_MATCH_BELOW_THRESHOLD")
          ? "SEMANTIC_MATCH_BELOW_THRESHOLD"
          : documentQuality.contradictions.length ? "CONTRADICTORY_INFORMATION" : "DOCUMENT_QUALITY_FAILURE"
    };
  }
  if (!passesAutoAssignmentConfidence(documentQuality?.evaluatorConfidence, complexity.complexityConfidence)) {
    return { status: "POOL_QUEUE", decisionPath: "ESCALATED", assigneeId: null, poolQueueReason: "INSUFFICIENT_EVALUATION_CONFIDENCE" };
  }
  if (!chosenUnderwriterId) {
    const hardPolicyFailure = evaluations?.some((evaluation) => evaluation.policies.some((policy) => ["Authority Limit", "Specialization", "Workload Balancing", "Availability"].includes(policy.policy) && !policy.passed));
    return { status: "POOL_QUEUE", decisionPath: "ESCALATED", assigneeId: null, poolQueueReason: hardPolicyFailure ? "POLICY_FAILURE" : "NO_ELIGIBLE_UNDERWRITER" };
  }
  if (complexity.band === "low") return { status: "ASSIGNED_STP", decisionPath: "STP", assigneeId: chosenUnderwriterId, poolQueueReason: null };
  return { status: "ASSIGNED_MANUAL", decisionPath: "MANUAL", assigneeId: chosenUnderwriterId, poolQueueReason: null };
}

function decisionLogAction(path: DecisionPath) {
  if (path === "STP") return "Auto-assignment executed (STP)";
  if (path === "MANUAL") return "Routed to manual review (non-STP)";
  if (path === "POOL_QUEUE") return "Document validation failed -- routed to Pool Queue";
  return "Escalated to Pool Queue";
}

function decisionLogDetail(path: DecisionPath, assigneeId: string | null, poolQueueReason?: UnderwritingCase["poolQueueReason"]) {
  const uw = assigneeId ? underwriterRegistry.find((u) => u.id === assigneeId) : null;
  if (path === "STP") return `Auto-assigned to ${uw?.name ?? assigneeId} -- no human review needed. Underwriter dashboard notified.`;
  if (path === "MANUAL") return `Tentatively matched to ${uw?.name ?? assigneeId} -- pending underwriter/ops manual review and confirmation.`;
  return poolQueueReason
    ? `Pool Queue reason: ${poolQueueReason}. Operations Manager alerted for manual review or override.`
    : "No qualifying underwriter found (Escalation Policy). Operations Manager alerted for manual override from Pool Queue.";
}

// Re-runs the Optimization Node only, used by "Request AI Re-routing" (an underwriter disputes the
// AI's complexity/specialty match after opening the file) and by Pool Queue escalations retrying
// after excluding an unavailable underwriter.
export async function rerouteCase(current: UnderwritingCase, reason: string, excludeUnderwriterId?: string): Promise<UnderwritingCase> {
  if (!current.complexity || !current.ner) {
    throw new Error("Case has no prior complexity/NER result to re-route from.");
  }

  const events: AuditEvent[] = [audit(current.id, "human", "Request AI Re-routing", reason)];

  const match = await runMatching(current.id, current.sumAssured, current.ner, current.complexity, excludeUnderwriterId);
  events.push(
    audit(
      current.id,
      "ai",
      `Filter Node + Optimization Node re-run (${match.engine})`,
      `${match.evaluations.filter((e) => e.eligible).length}/${match.evaluations.length} underwriters eligible. ${match.rationale}`
    )
  );

  const { status, decisionPath, assigneeId, poolQueueReason } = decide(current.complexity, match.chosenUnderwriterId, match.evaluations, current.documentQuality);
  events.push(audit(current.id, "system", decisionLogAction(decisionPath), decisionLogDetail(decisionPath, assigneeId, poolQueueReason)));

  return {
    ...current,
    status,
    decisionPath,
    match,
    assigneeId,
    poolQueueReason,
    updatedAt: timestamp(),
    // Audit events are always stored oldest-first (chronological); sort descending at display time.
    audit: [...current.audit, ...events]
  };
}

export function applyOverride(current: UnderwritingCase, underwriterId: string, note: string): UnderwritingCase {
  const uw = underwriterRegistry.find((u) => u.id === underwriterId);
  const event = audit(current.id, "human", "Ops Manager manual override", `${note} Assigned to ${uw?.name ?? underwriterId}.`);

  return {
    ...current,
    status: "ASSIGNED_MANUAL",
    decisionPath: "MANUAL",
    assigneeId: underwriterId,
    updatedAt: timestamp(),
    audit: [...current.audit, event]
  };
}

export function resolveCase(current: UnderwritingCase, note: string): UnderwritingCase {
  const event = audit(current.id, "human", "Case resolved", note || "Underwriter finalized the decision.");
  return { ...current, status: "RESOLVED", updatedAt: timestamp(), audit: [...current.audit, event] };
}

// Distinct from "Request AI Re-routing": the underwriter rejects the AI's match outright and sends
// the case straight to the Pool Queue for a human (Ops Manager) pick, instead of asking the
// Optimization Node to try again automatically.
export function rejectToPoolQueue(current: UnderwritingCase, reason: string): UnderwritingCase {
  const event = audit(current.id, "human", "Assignment rejected -- escalated to Pool Queue", reason || "Underwriter rejected the AI-suggested assignment.");
  return {
    ...current,
    status: "POOL_QUEUE",
    decisionPath: "ESCALATED",
    assigneeId: null,
    updatedAt: timestamp(),
    audit: [...current.audit, event]
  };
}
