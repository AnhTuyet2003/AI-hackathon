import { extractDocuments, type UploadedFile } from "./document-ingest";
import { runMatching } from "./matching";
import {
  appendAudit,
  finalizeMatch,
  localMatch,
  mayAssign,
  pool,
  prepareIntake,
} from "./intake-engine";
import { INTAKE_POLICY } from "./intake-policy";
import { evaluateUnderwriter } from "./policies";
import { underwriterRegistry } from "./underwriters";
import type {
  ApplicationInput,
  DocumentExtraction,
  ReconciliationLog,
  UnderwritingCase,
} from "./types";

export const MIN_AUTO_ASSIGN_CONFIDENCE = INTAKE_POLICY.confidenceMinimum;
export const passesAutoAssignmentConfidence = (
  d: number | null | undefined,
  c: number,
) =>
  typeof d === "number" &&
  d >= MIN_AUTO_ASSIGN_CONFIDENCE &&
  c >= MIN_AUTO_ASSIGN_CONFIDENCE;
export type IngestOptions = {
  files?: UploadedFile[];
  extractions?: DocumentExtraction[];
  reconciliation?: ReconciliationLog | null;
  documentSessionId?: string;
  verified?: boolean;
};

export async function runIntakePipeline(
  input: ApplicationInput,
  opts: IngestOptions = {},
) {
  const extractions = opts.files?.length
    ? await extractDocuments(opts.files)
    : (opts.extractions ?? []);
  const c = prepareIntake(
    input,
    extractions,
    `APP-${crypto.randomUUID()}`,
    opts.verified !== false,
  );
  if (opts.reconciliation) {
    c.ingestion!.reconciliation = opts.reconciliation;
    // Insert reconciliation before gate events, reflecting when the supplied decisions occurred.
    const e = {
      id: `${c.id}-reconciliation`,
      caseId: c.id,
      actor: "human" as const,
      action: "User reconciliation completed",
      detail: JSON.stringify(opts.reconciliation),
      createdAt: c.createdAt,
    };
    c.audit.splice(1, 0, e);
  }
  if (c.status === "POOL_QUEUE") return c;
  const match =
    process.env.AI_UD_LIVE_SERVICES === "true"
      ? await runMatching(c.id, c.sumAssured, c.ner!, c.complexity!)
      : localMatch(c);
  return finalizeMatch(c, match);
}

export async function rerouteCase(
  current: UnderwritingCase,
  reason: string,
  excludeUnderwriterId?: string,
) {
  if (!mayAssign(current))
    throw new Error("Correct the evidence and resubmit before rerouting.");
  if (current.status === "RESOLVED")
    throw new Error("Resolved cases cannot be rerouted.");
  const c = structuredClone(current);
  appendAudit(c, "Request AI Re-routing", reason, "human");
  return finalizeMatch(
    c,
    process.env.AI_UD_LIVE_SERVICES === "true"
      ? await runMatching(
          c.id,
          c.sumAssured,
          c.ner!,
          c.complexity!,
          excludeUnderwriterId,
        )
      : localMatch(c, excludeUnderwriterId),
  );
}

export function applyOverride(
  current: UnderwritingCase,
  underwriterId: string,
  note: string,
) {
  if (!mayAssign(current) || current.status === "RESOLVED")
    throw new Error(
      "Correct and re-evaluate the evidence before underwriting assignment.",
    );
  const uw = underwriterRegistry.find((u) => u.id === underwriterId);
  if (
    !uw ||
    !evaluateUnderwriter(
      uw,
      current.sumAssured,
      current.ner!,
      current.complexity!,
    ).eligible
  )
    throw new Error(
      "Selected underwriter does not meet the current policy requirements.",
    );
  const c = structuredClone(current);
  c.status = "ASSIGNED_MANUAL";
  c.decisionPath = "MANUAL";
  c.underwritingDecision = "MANUAL";
  c.assigneeId = uw.id;
  c.poolQueueReason = null;
  c.updatedAt = new Date().toISOString();
  appendAudit(c, "Ops Manager manual assignment", note, "human");
  return c;
}

export function resolveCase(current: UnderwritingCase, note: string) {
  if (
    !mayAssign(current) ||
    !current.assigneeId ||
    !["ASSIGNED_STP", "ASSIGNED_MANUAL"].includes(current.status)
  )
    throw new Error("Only an assigned, validated case can be resolved.");
  const c = structuredClone(current);
  c.status = "RESOLVED";
  c.updatedAt = new Date().toISOString();
  appendAudit(
    c,
    "Case resolved",
    note ||
      "Review workflow completed; this is not a policy approval or payment decision.",
    "human",
  );
  return c;
}

export function rejectToPoolQueue(current: UnderwritingCase, reason: string) {
  if (current.status === "RESOLVED")
    throw new Error("Resolved cases cannot be rejected.");
  return pool(
    structuredClone(current),
    "COMPLEXITY_REQUIRES_MANUAL_REVIEW",
    reason || "Underwriter requested operations review.",
  );
}
