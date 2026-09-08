import { evaluateAndRank } from "./matching";
import { detectMissingFields, extractEntities, scoreComplexity } from "./mock-ai";
import type { ApplicationInput, AuditEvent, CaseStatus, DecisionPath, UnderwritingCase, Underwriter } from "./types";
import { queueLoadCapByTier, underwriterRegistry } from "./underwriters";
import { applicationFixtures, demoIngestionByKey, generateApplications } from "@/test/fixtures/applications";

// Initial dashboard state, built synchronously and deterministically at module load -- no network
// call, no Gemini/MCP dependency -- so every view has data even before a live case is submitted.
//
// The application inputs come from test/fixtures/applications.ts (shared with the Submit form's
// demo buttons and test/verify.mjs). The curated list covers every branch the intake pipeline can
// take; the generator adds background volume so the dashboard charts are populated.

let seedCounter = 0;
function seedId(prefix: string) {
  seedCounter += 1;
  return `${prefix}-SEED${seedCounter}`;
}

function seedAudit(caseId: string, actor: AuditEvent["actor"], action: string, detail: string, minutesAgo: number): AuditEvent {
  return { id: `${caseId}-evt${minutesAgo}`, caseId, actor, action, detail, createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() };
}

// A mutable copy of the registry whose queue loads grow as each seed case is assigned. Passing this
// to evaluateAndRank makes seeded assignments spread across the roster instead of every no-specialty
// case landing on the single lowest-queue underwriter. Live cases (lib/pipeline.ts) still evaluate
// against the real static registry.
const workingRegistry: Underwriter[] = underwriterRegistry.map((uw) => ({ ...uw }));

type BuildOptions = { minutesAgo: number; resolveNote?: string; sampleKey?: string };

function buildSeedCase(input: ApplicationInput, { minutesAgo, resolveNote, sampleKey }: BuildOptions): UnderwritingCase {
  const caseId = seedId("APP");
  const demo = sampleKey ? demoIngestionByKey[sampleKey] : undefined;
  const { missingFields, followUpMessage } = detectMissingFields(input);
  const ner = extractEntities(input);
  const complexity = scoreComplexity(input, ner);
  const { evaluations, eligibleUnderwriters } = evaluateAndRank(input.sumAssured, ner, complexity, undefined, workingRegistry);
  const chosen = eligibleUnderwriters[0] ?? null;

  if (chosen) {
    const slot = workingRegistry.find((uw) => uw.id === chosen.id);
    // Nudge the queue up so later seed cases rank differently, but never let a seed assignment push
    // an underwriter to their cap -- otherwise late cases escalate purely because earlier demo data
    // filled the roster, which reads as a broken pipeline rather than a realistic snapshot.
    if (slot) slot.currentQueueLoad = Math.min(slot.currentQueueLoad + 1, queueLoadCapByTier[slot.tier] - 1);
  }

  let status: CaseStatus = !chosen ? "POOL_QUEUE" : complexity.band === "low" ? "ASSIGNED_STP" : "ASSIGNED_MANUAL";
  const decisionPath: DecisionPath = !chosen ? "ESCALATED" : complexity.band === "low" ? "STP" : "MANUAL";

  const events: AuditEvent[] = [
    seedAudit(caseId, "system", "Case submitted", "Status set to PENDING; entered Data Ingestion Engine.", minutesAgo + 6),
    ...(demo
      ? [
          seedAudit(
            caseId,
            "ai",
            "Document Ingestion Engine",
            `Parsed ${demo.extractions.length} document(s): ${demo.extractions.map((e) => `${e.fileName} [${e.kind}, ${e.provider}]`).join("; ")}.`,
            minutesAgo + 5
          ),
          ...demo.ingestion.overriddenFields.map((o) =>
            seedAudit(caseId, "ai", "Field overridden from document", `${o.field}: "${o.from}" -> "${o.to}" (source: ${o.source}).`, minutesAgo + 5)
          )
        ]
      : []),
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

  let updatedAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  if (resolveNote) {
    // Closed roughly a third of the way back toward "now" from when it was submitted.
    const resolvedMinutesAgo = Math.round(minutesAgo * 0.35);
    events.push(seedAudit(caseId, "human", "Case resolved", resolveNote, resolvedMinutesAgo));
    status = "RESOLVED";
    updatedAt = new Date(Date.now() - resolvedMinutesAgo * 60_000).toISOString();
  }

  return {
    ...input,
    id: caseId,
    status,
    decisionPath,
    missingFields,
    followUpMessage,
    complexity,
    ner,
    match: {
      chosenUnderwriterId: chosen?.id ?? null,
      evaluations,
      engine: "greedy-fallback",
      rationale: "Seeded demo case (deterministic engine)."
    },
    assigneeId: chosen?.id ?? null,
    provider: "fallback",
    documentExtractions: demo?.extractions ?? [],
    ingestion: demo?.ingestion ?? null,
    createdAt: new Date(Date.now() - (minutesAgo + 6) * 60_000).toISOString(),
    updatedAt,
    audit: events
  };
}

const curatedCases = applicationFixtures.map((fixture) =>
  buildSeedCase(fixture.input, { minutesAgo: fixture.minutesAgo, resolveNote: fixture.resolveNote, sampleKey: fixture.key })
);

// Background volume: generated cases spread across the last ~30 days (ascending age, so the most
// recent generated case is a few hours old).
const generatedCases = generateApplications(16, 20260907).map((input, index) =>
  buildSeedCase(input, { minutesAgo: 320 + index * 2_500 })
);

export const seedCases: UnderwritingCase[] = [...curatedCases, ...generatedCases].sort(
  (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
);

export { underwriterRegistry };
