import { runGeminiAnalysis } from "./gemini-ai";
import { runMatching } from "./matching";
import { detectMissingFields, extractEntities, scoreComplexity } from "./mock-ai";
import { underwriterRegistry } from "./underwriters";
import type { ApplicationInput, AuditEvent, CaseStatus, DecisionPath, UnderwritingCase } from "./types";

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
export async function runIntakePipeline(input: ApplicationInput): Promise<UnderwritingCase> {
  const caseId = id("APP");
  const now = timestamp();
  const events: AuditEvent[] = [audit(caseId, "system", "Case submitted", "Status set to PENDING; entered Data Ingestion Engine.")];

  const { missingFields, followUpMessage } = detectMissingFields(input);
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
    const analysis = await runGeminiAnalysis(input);
    complexity = analysis.complexity;
    ner = analysis.ner;
    provider = "gemini";
    events.push(audit(caseId, "ai", "Complexity Classifier + NER (Gemini)", `${complexity.reasonCode} Specialties required: ${ner.specialtiesRequired.join(", ") || "none"}.`));
  } catch (error) {
    ner = extractEntities(input);
    complexity = scoreComplexity(input, ner);
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

  const match = await runMatching(caseId, input.sumAssured, ner, complexity);
  events.push(
    audit(
      caseId,
      "ai",
      `Filter Node + Optimization Node (${match.engine})`,
      `${match.evaluations.filter((e) => e.eligible).length}/${match.evaluations.length} underwriters eligible. ${match.rationale}`
    )
  );

  const { status, decisionPath, assigneeId } = decide(complexity.band, match.chosenUnderwriterId);
  events.push(audit(caseId, "system", decisionLogAction(decisionPath), decisionLogDetail(decisionPath, assigneeId)));

  return {
    ...input,
    id: caseId,
    status,
    decisionPath,
    missingFields,
    followUpMessage,
    complexity,
    ner,
    match,
    assigneeId,
    provider,
    createdAt: now,
    updatedAt: timestamp(),
    audit: events
  };
}

function decide(band: "low" | "medium" | "high", chosenUnderwriterId: string | null): { status: CaseStatus; decisionPath: DecisionPath; assigneeId: string | null } {
  if (!chosenUnderwriterId) return { status: "POOL_QUEUE", decisionPath: "ESCALATED", assigneeId: null };
  if (band === "low") return { status: "ASSIGNED_STP", decisionPath: "STP", assigneeId: chosenUnderwriterId };
  return { status: "ASSIGNED_MANUAL", decisionPath: "MANUAL", assigneeId: chosenUnderwriterId };
}

function decisionLogAction(path: DecisionPath) {
  if (path === "STP") return "Auto-assignment executed (STP)";
  if (path === "MANUAL") return "Routed to manual review (non-STP)";
  return "Escalated to Pool Queue";
}

function decisionLogDetail(path: DecisionPath, assigneeId: string | null) {
  const uw = assigneeId ? underwriterRegistry.find((u) => u.id === assigneeId) : null;
  if (path === "STP") return `Auto-assigned to ${uw?.name ?? assigneeId} -- no human review needed. Underwriter dashboard notified.`;
  if (path === "MANUAL") return `Tentatively matched to ${uw?.name ?? assigneeId} -- pending underwriter/ops manual review and confirmation.`;
  return "No qualifying underwriter found (Escalation Policy). Operations Manager alerted for manual override from Pool Queue.";
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

  const { status, decisionPath, assigneeId } = decide(current.complexity.band, match.chosenUnderwriterId);
  events.push(audit(current.id, "system", decisionLogAction(decisionPath), decisionLogDetail(decisionPath, assigneeId)));

  return {
    ...current,
    status,
    decisionPath,
    match,
    assigneeId,
    updatedAt: timestamp(),
    audit: [...events, ...current.audit]
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
    audit: [event, ...current.audit]
  };
}

export function resolveCase(current: UnderwritingCase, note: string): UnderwritingCase {
  const event = audit(current.id, "human", "Case resolved", note || "Underwriter finalized the decision.");
  return { ...current, status: "RESOLVED", updatedAt: timestamp(), audit: [event, ...current.audit] };
}
