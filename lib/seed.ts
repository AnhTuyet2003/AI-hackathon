import { evaluateAndRank } from "./matching";
import { detectMissingFields, extractEntities, scoreComplexity } from "./mock-ai";
import type { ApplicationInput, AuditEvent, CaseStatus, DecisionPath, UnderwritingCase } from "./types";
import { underwriterRegistry } from "./underwriters";

// Three required demo scenarios (build spec Sect. 7 deliverable #3), built synchronously and
// deterministically at module load -- no network call, no Gemini/MCP dependency -- so the
// dashboard always has data to show even before a live case is submitted.

let seedCounter = 0;
function seedId(prefix: string) {
  seedCounter += 1;
  return `${prefix}-SEED${seedCounter}`;
}

function seedAudit(caseId: string, actor: AuditEvent["actor"], action: string, detail: string, minutesAgo: number): AuditEvent {
  return { id: `${caseId}-evt${minutesAgo}`, caseId, actor, action, detail, createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() };
}

function buildSeedCase(input: ApplicationInput, minutesAgo: number): UnderwritingCase {
  const caseId = seedId("APP");
  const { missingFields, followUpMessage } = detectMissingFields(input);
  const ner = extractEntities(input);
  const complexity = scoreComplexity(input, ner);
  const { evaluations, eligibleUnderwriters } = evaluateAndRank(input.sumAssured, ner, complexity);
  const chosen = eligibleUnderwriters[0] ?? null;

  const status: CaseStatus = !chosen ? "POOL_QUEUE" : complexity.band === "low" ? "ASSIGNED_STP" : "ASSIGNED_MANUAL";
  const decisionPath: DecisionPath = !chosen ? "ESCALATED" : complexity.band === "low" ? "STP" : "MANUAL";

  const events: AuditEvent[] = [
    seedAudit(caseId, "system", "Case submitted", "Status set to PENDING; entered Data Ingestion Engine.", minutesAgo + 6),
    seedAudit(caseId, "ai", "Completeness check", missingFields.length ? `Missing: ${missingFields.join(", ")}.` : "Application package is complete.", minutesAgo + 5),
    seedAudit(caseId, "ai", "Complexity Classifier + NER (rule-based fallback)", `${complexity.reasonCode} Specialties required: ${ner.specialtiesRequired.join(", ") || "none"}.`, minutesAgo + 4),
    seedAudit(
      caseId,
      "ai",
      "Filter Node + Optimization Node (greedy-fallback)",
      `${evaluations.filter((e) => e.eligible).length}/${evaluations.length} underwriters eligible.`,
      minutesAgo + 2
    ),
    seedAudit(
      caseId,
      "system",
      decisionPath === "STP" ? "Auto-assignment executed (STP)" : decisionPath === "MANUAL" ? "Routed to manual review (non-STP)" : "Escalated to Pool Queue",
      chosen ? `${decisionPath === "STP" ? "Auto-assigned" : "Tentatively matched"} to ${chosen.name}.` : "No qualifying underwriter -- Operations Manager alerted.",
      minutesAgo
    )
  ];

  return {
    ...input,
    id: caseId,
    status,
    decisionPath,
    missingFields,
    followUpMessage,
    complexity,
    ner,
    match: { chosenUnderwriterId: chosen?.id ?? null, evaluations, engine: "greedy-fallback", rationale: "Seeded demo case (deterministic engine)." },
    assigneeId: chosen?.id ?? null,
    provider: "fallback",
    createdAt: new Date(Date.now() - (minutesAgo + 6) * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    audit: events
  };
}

// Scenario (a): clean, low-complexity case -> STP auto-assign.
const stpCase = buildSeedCase(
  {
    applicantName: "Nguyen Van An",
    age: 29,
    sumAssured: 80_000,
    occupation: "Software Engineer",
    productLine: "Individual Life",
    medicalHistory: "No significant medical history. Non-smoker, regular annual checkups.",
    disclosures: "No prior claims or declined applications.",
    documents: ["application-form.pdf", "id-verification.pdf"]
  },
  40
);

// Scenario (b): medium-complexity case needing a specialist match (Cardiology).
const specialistCase = buildSeedCase(
  {
    applicantName: "Tran Thi Bich",
    age: 52,
    sumAssured: 350_000,
    occupation: "Restaurant Owner",
    productLine: "Individual Life",
    medicalHistory: "History of controlled hypertension and one prior episode of Myocardial Infarction, managed with medication since 2023.",
    disclosures: "Applicant discloses cardiac medication use; no hospitalization in the last 12 months.",
    documents: ["application-form.pdf", "medical-questionnaire.pdf", "doctor-notes.pdf"]
  },
  25
);

// Scenario (c): high-complexity case, no available senior/medical underwriter -> Pool Queue.
// Both Medical-tier underwriters are unavailable for this case: Dr. Alex Minh is DND, and
// Dr. Lan Pham's queue (11) is over the Medical tier cap (8) from lib/underwriters.ts.
const escalationCase = buildSeedCase(
  {
    applicantName: "Le Hoang Minh",
    age: 63,
    sumAssured: 1_800_000,
    occupation: "Offshore Drilling Supervisor",
    productLine: "Individual Life",
    medicalHistory:
      "Complex multi-morbidity profile: Type 2 Diabetes with recurring complications, history of Myocardial Infarction, and chronic liver condition (early-stage cirrhosis).",
    disclosures: "High-net-worth applicant seeking HNW financial profiling review alongside medical underwriting.",
    documents: ["application-form.pdf", "medical-questionnaire.pdf", "doctor-notes.pdf", "financial-statement.pdf"]
  },
  10
);

export const seedCases: UnderwritingCase[] = [stpCase, specialistCase, escalationCase];

export { underwriterRegistry };
