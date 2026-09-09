import { classifyCareDocuments } from "./care-classifier";
import { CARE_POLICY_VERSION, decideCareRoute } from "./care-routing";
import { evaluateDocumentQuality } from "./document-quality";
import { extractEntities, scoreComplexity } from "./mock-ai";
import { applicationOnly, realDate, usable } from "./evidence-text";
import { INTAKE_POLICY } from "./intake-policy";
import { evaluateUnderwriter } from "./policies";
import { underwriterRegistry } from "./underwriters";
import type {
  ApplicationInput,
  DocumentExtraction,
  ExtractedFields,
  MatchResult,
  PoolQueueReason,
  UnderwritingCase,
} from "./types";

export function appendAudit(
  c: UnderwritingCase,
  action: string,
  detail: string,
  actor: "system" | "ai" | "human" = "system",
) {
  c.audit.push({
    id: `${c.id}-evt-${c.audit.length + 1}`,
    caseId: c.id,
    actor,
    action,
    detail,
    createdAt: new Date().toISOString(),
  });
}

export function pool(
  c: UnderwritingCase,
  reason: PoolQueueReason,
  detail: string,
) {
  c.status = "POOL_QUEUE";
  c.decisionPath = "POOL_QUEUE";
  c.assigneeId = null;
  c.poolQueueReason = reason;
  appendAudit(c, "Sent to Pool Queue", `${reason}: ${detail}`);
  return c;
}

export function documentFields(extractions: DocumentExtraction[]) {
  return Object.assign(
    {},
    ...extractions.map((e) =>
      Object.fromEntries(
        Object.entries(e.fields).filter(([, v]) => v != null && v !== ""),
      ),
    ),
  ) as ExtractedFields;
}

export function documentRequiredFields(f: ExtractedFields) {
  return [
    ["document identity", usable(f.patientName) || usable(f.policyNumber)],
    [
      "provider or facility",
      usable(f.facilityName) || usable(f.providerCode) || usable(f.department),
    ],
    [
      "service date",
      typeof f.serviceStart === "string" && realDate(f.serviceStart),
    ],
    ["reason for care", usable(f.chiefComplaint) || usable(f.symptoms)],
    ["treatment or service", usable(f.treatment) || usable(f.procedures)],
    [
      "diagnosis or clinical assessment",
      usable(f.diagnosis) || usable(f.diagnosisCode),
    ],
  ]
    .filter(([, ok]) => !ok)
    .map(([label]) => String(label));
}

function normalizeContradictionValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
    return normalized || null;
  }
  return null;
}

function findCrossDocumentContradiction(extractions: DocumentExtraction[]) {
  const fieldsToCheck = [
    "patientName",
    "policyNumber",
    "serviceStart",
    "serviceEnd",
    "providerCode",
    "facilityName",
    "department",
    "billingAmount",
    "eligibleAmount",
    "insurerPayment",
  ] as const;

  for (const field of fieldsToCheck) {
    const uniqueValues = new Set(
      extractions
        .map((e) => normalizeContradictionValue(e.fields[field]))
        .filter((v): v is string => !!v),
    );
    if (uniqueValues.size > 1) {
      return {
        field,
        values: [...uniqueValues],
      };
    }
  }

  return null;
}

export function prepareIntake(
  input: ApplicationInput,
  extractions: DocumentExtraction[],
  id: string,
  verified = true,
): UnderwritingCase {
  const now = new Date().toISOString();
  // Document findings remain separate even when the user previously added a marked summary.
  input = {
    ...input,
    medicalHistory: applicationOnly(input.medicalHistory),
    disclosures: applicationOnly(input.disclosures),
  };
  const c: UnderwritingCase = {
    ...input,
    id,
    status: "PENDING",
    decisionPath: null,
    missingFields: [],
    followUpMessage: "",
    complexity: null,
    ner: null,
    match: null,
    assigneeId: null,
    poolQueueReason: null,
    provider: "fallback",
    documentExtractions: extractions,
    ingestion: {
      extractions,
      filledFields: [],
      overriddenFields: [],
      appendedToMedicalHistory: false,
      mode: "reconciled",
    },
    documentQuality: null,
    documentSessionId: extractions[0]?.documentSessionId,
    intakePolicyVersion: INTAKE_POLICY.version,
    evidenceVerified: verified,
    underwritingDecision: "NOT_EVALUATED",
    createdAt: now,
    updatedAt: now,
    audit: [],
  };
  appendAudit(
    c,
    "Case submitted",
    "Current application and document evidence received.",
  );
  for (const e of extractions)
    appendAudit(
      c,
      "Document evidence extracted",
      `${e.fileName}; session ${e.documentSessionId ?? "synthetic"}; hash ${e.sourceFileHash ?? "synthetic"}; source ${e.source ?? "unknown"}. ${e.warnings.join(" ")}`,
    );
  if (!verified)
    return pool(
      c,
      "UNVERIFIED_EVIDENCE",
      "Original document evidence must be verified before automatic underwriting assignment.",
    );
  const f = documentFields(extractions);
  const missing = [
    !usable(input.applicantName) && "applicant name",
    !usable(input.occupation) && "occupation",
    (!Number.isFinite(input.age) || input.age < 1 || input.age > 120) && "age",
    (!Number.isFinite(input.sumAssured) || input.sumAssured <= 0) &&
      "sum assured",
    !extractions.length && "supporting documents",
  ].filter(Boolean) as string[];
  if (
    extractions.length &&
    extractions.some((e) => e.readable === false || !e.rawText?.trim())
  ) {
    c.documentQuality = evaluateDocumentQuality(extractions);
    return pool(
      c,
      "DOCUMENT_UNREADABLE",
      "Supply readable text or verified OCR; no complexity or matching was run.",
    );
  }
  if (extractions.length) missing.push(...documentRequiredFields(f));
  c.missingFields = missing;
  appendAudit(
    c,
    "Required fields checked",
    missing.length ? missing.join(", ") : "Common required fields passed.",
  );
  if (missing.length) {
    c.followUpMessage = `Please provide or correct: ${missing.join(", ")}.`;
    if (extractions.length)
      c.documentQuality = evaluateDocumentQuality(extractions);
    return pool(c, "REQUIRED_FIELDS_FAILED", c.followUpMessage);
  }

  const crossDocumentContradiction =
    findCrossDocumentContradiction(extractions);
  if (crossDocumentContradiction) {
    return pool(
      c,
      "CONTRADICTORY_INFORMATION",
      `Conflicting ${crossDocumentContradiction.field} across uploaded documents: ${crossDocumentContradiction.values.join(" vs ")}.`,
    );
  }

  for (const key of ["patientName", "policyNumber"] as const) {
    const values = extractions
      .map((e) => e.fields[key])
      .filter(usable)
      .map((v) => String(v).trim().toLowerCase());
    if (new Set(values).size > 1)
      return pool(
        c,
        "CONTRADICTORY_INFORMATION",
        `Conflicting ${key} across documents; do not merge evidence across people or policies.`,
      );
  }
  if (
    f.patientName &&
    f.patientName.trim().toLowerCase() !==
      input.applicantName.trim().toLowerCase()
  )
    return pool(
      c,
      "CONTRADICTORY_INFORMATION",
      "Document patient and applicant names differ. Reconcile identity before processing.",
    );
  const documents = extractions.map((e, i) => ({
    id: `D${i + 1}`,
    text: e.rawText!,
  }));
  const evidence = classifyCareDocuments(documents);
  // Common identity/date requirements were checked above. This adapter isolates the shared category policy from claim-specific transport IDs.
  const decision = decideCareRoute(
    {
      submissionId: id,
      submissionUse: "preauthorization",
      memberId: input.applicantName,
      policyId: f.policyNumber || "new-business",
      providerId: f.providerCode || f.facilityName || f.department!,
      serviceDate: new Date(f.serviceStart!).toISOString().slice(0, 10),
      documents,
    },
    evidence,
  );
  c.careEvidence = evidence;
  c.careDecision = decision;
  appendAudit(
    c,
    "Care categories evaluated",
    `${CARE_POLICY_VERSION}; supported: ${decision.matchedCategories.join(", ") || "none"}; uncertain: ${decision.uncertainCategories.join(", ") || "none"}.`,
  );
  if (!decision.category)
    return pool(
      c,
      decision.reason as PoolQueueReason,
      "Exactly one supported category with no uncertainty is required.",
    );
  c.documentQuality = evaluateDocumentQuality(
    extractions,
    "deterministic-fallback",
    decision.category,
  );
  appendAudit(
    c,
    "Document quality evaluated",
    `${c.documentQuality.score}/10; ${c.documentQuality.validationStatus}; ${c.documentQuality.reasonCodes.join(", ")}. Profile match and confidence are heuristics.`,
  );
  if (c.documentQuality.validationStatus === "FAILED")
    return pool(
      c,
      c.documentQuality.contradictions.some((q) => q.penalty > 0)
        ? "CONTRADICTORY_INFORMATION"
        : c.documentQuality.semanticMatchScore < INTAKE_POLICY.semanticMinimum
          ? "SEMANTIC_MATCH_BELOW_THRESHOLD"
          : "DOCUMENT_QUALITY_FAILURE",
      "Document evidence did not pass; complexity and matching were not run.",
    );
  c.ner = extractEntities(input, f);
  c.complexity = scoreComplexity(input, c.ner, f);
  appendAudit(
    c,
    "Specialties extracted",
    `${c.ner.specialtiesRequired.join(", ") || "No confirmed specialty"}; confidence ${c.ner.confidence}.`,
  );
  appendAudit(c, "Complexity evaluated", c.complexity.reasonCode);
  if (!passesConfidence(c))
    return pool(
      c,
      "INSUFFICIENT_EVALUATION_CONFIDENCE",
      "Quality passing is insufficient without evaluator, specialty and complexity confidence.",
    );
  appendAudit(
    c,
    "Confidence gate passed",
    `All confidence indicators meet ${INTAKE_POLICY.confidenceMinimum}.`,
  );
  return c;
}
export function passesConfidence(c: UnderwritingCase) {
  return [
    c.documentQuality?.evaluatorConfidence,
    c.complexity?.complexityConfidence,
    c.ner?.confidence,
  ].every(
    (v) =>
      typeof v === "number" &&
      Number.isFinite(v) &&
      v >= INTAKE_POLICY.confidenceMinimum,
  );
}
export function mayAssign(c: UnderwritingCase) {
  return (
    c.intakePolicyVersion === INTAKE_POLICY.version &&
    c.evidenceVerified === true &&
    !c.missingFields.length &&
    !!c.careDecision?.category &&
    c.documentQuality?.validationStatus === "PASSED" &&
    c.documentQuality.score >= INTAKE_POLICY.qualityMinimum &&
    passesConfidence(c)
  );
}
export function finalizeMatch(c: UnderwritingCase, match: MatchResult) {
  if (!mayAssign(c))
    throw new Error(
      "Evidence must pass every gate before matching or assignment.",
    );
  c.match = match;
  appendAudit(c, "Policies and matching evaluated", match.rationale);
  if (
    !match.chosenUnderwriterId ||
    !match.evaluations.some(
      (e) => e.underwriterId === match.chosenUnderwriterId && e.eligible,
    )
  )
    return pool(
      c,
      "NO_ELIGIBLE_UNDERWRITER",
      "No available underwriter satisfies authority, specialty and workload requirements.",
    );
  const stp =
    c.complexity!.band === "low" && c.ner!.specialtiesRequired.length === 0;
  c.status = stp ? "ASSIGNED_STP" : "ASSIGNED_MANUAL";
  c.decisionPath = stp ? "STP" : "MANUAL";
  c.underwritingDecision = c.decisionPath;
  c.assigneeId = match.chosenUnderwriterId;
  c.poolQueueReason = null;
  appendAudit(
    c,
    "Assignment created",
    `${c.decisionPath}: ${c.assigneeId}. Notification shown in local dashboard; no external notification sent.`,
  );
  return c;
}
export function localMatch(c: UnderwritingCase, exclude?: string): MatchResult {
  const evaluations = underwriterRegistry
    .filter((u) => u.id !== exclude)
    .map((u) => evaluateUnderwriter(u, c.sumAssured, c.ner!, c.complexity!));
  const eligible = underwriterRegistry
    .filter((u) =>
      evaluations.some((e) => e.underwriterId === u.id && e.eligible),
    )
    .sort(
      (a, b) =>
        a.currentQueueLoad - b.currentQueueLoad ||
        b.specializationTags.filter((s) =>
          c.ner!.specialtiesRequired.includes(s),
        ).length -
          a.specializationTags.filter((s) =>
            c.ner!.specialtiesRequired.includes(s),
          ).length ||
        a.slaMinutesRemainingAvg - b.slaMinutesRemainingAvg ||
        a.id.localeCompare(b.id),
    );
  return {
    chosenUnderwriterId: eligible[0]?.id ?? null,
    evaluations,
    engine: "greedy-fallback",
    rationale:
      "Local deterministic matching: eligibility, queue depth, specialty match and SLA.",
  };
}
