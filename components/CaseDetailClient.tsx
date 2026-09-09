"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CommandBar,
  CommandButton,
  CommandDivider,
  FieldRow,
  FormGrid,
  FormSection,
  RecordHeader,
  ScoreBar,
  StatusDot,
  TabBar,
} from "@/components/ModelDriven";
import { getCases, saveCases } from "@/lib/local-store";
import { underwriterRegistry } from "@/lib/underwriters";
import { formatComplexityReason } from "@/lib/mock-ai";
import type {
  DocumentExtraction,
  ExtractedFields,
  UnderwritingCase,
} from "@/lib/types";

const TABS = [
  "Assessment",
  "Documents",
  "Allocation Matrix",
  "Actions",
  "Audit",
] as const;
type Tab = (typeof TABS)[number];

const STATUS_TEXT: Record<UnderwritingCase["status"], string> = {
  PENDING: "Pending",
  ASSIGNED_STP: "Auto-assigned (STP)",
  ASSIGNED_MANUAL: "Manual review",
  POOL_QUEUE: "Pool Queue",
  RESOLVED: "Resolved",
};

export function CaseDetailClient({ caseId }: { caseId: string }) {
  const [cases, setCases] = useState<UnderwritingCase[]>([]);
  const caseItem = useMemo(
    () => cases.find((c) => c.id === caseId),
    [caseId, cases],
  );
  const [tab, setTab] = useState<Tab>("Assessment");
  const [busy, setBusy] = useState(false);
  const [rerouteReason, setRerouteReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCases(getCases());
  }, []);

  function persist(updated: UnderwritingCase) {
    const next = cases.map((c) => (c.id === updated.id ? updated : c));
    setCases(next);
    saveCases(next);
  }

  async function requestReroute() {
    if (!caseItem) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/cases/reroute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case: caseItem,
          reason:
            rerouteReason ||
            "Underwriter opened the file and found hidden complexities.",
          excludeUnderwriterId: caseItem.assigneeId ?? undefined,
        }),
      });
      const payload = (await response.json()) as {
        case?: UnderwritingCase;
        error?: string;
      };
      if (!response.ok || !payload.case)
        throw new Error(payload.error || "Re-routing failed.");
      persist(payload.case);
      setRerouteReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveCase() {
    if (!caseItem) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/cases/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case: caseItem,
          note: "Underwriter confirmed and resolved the case.",
        }),
      });
      const payload = (await response.json()) as {
        case?: UnderwritingCase;
        error?: string;
      };
      if (!response.ok || !payload.case)
        throw new Error(payload.error || "Resolve failed.");
      persist(payload.case);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function rejectCase() {
    if (!caseItem) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/cases/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case: caseItem,
          reason:
            rejectReason ||
            "Underwriter rejected the AI-suggested assignment outright.",
        }),
      });
      const payload = (await response.json()) as {
        case?: UnderwritingCase;
        error?: string;
      };
      if (!response.ok || !payload.case)
        throw new Error(payload.error || "Reject failed.");
      persist(payload.case);
      setRejectReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!caseItem) {
    return (
      <>
        <CommandBar>
          <CommandButton icon="←" onClick={() => history.back()}>
            Back
          </CommandButton>
        </CommandBar>
        <div className="m-4 shell-card p-6">
          <h1 className="text-[19px] font-semibold">Case not found</h1>
          <p className="mt-2 text-muted">
            The case may not exist in local demo storage.
          </p>
          <Link className="primary-button mt-4 inline-flex" href="/">
            Back to dashboard
          </Link>
        </div>
      </>
    );
  }

  const assignee = caseItem.assigneeId
    ? underwriterRegistry.find((u) => u.id === caseItem.assigneeId)
    : null;
  const isLocked =
    caseItem.status === "RESOLVED" || !caseItem.snapshotSignature;
  const isPooled = caseItem.status === "POOL_QUEUE";
  const documentQualityFailed =
    caseItem.documentQuality?.validationStatus === "FAILED";

  return (
    <>
      <CommandBar>
        <Link className="command-button" href="/">
          <span aria-hidden className="text-[15px] leading-none">
            ←
          </span>
          Back
        </Link>
        <CommandDivider />
        {!isLocked && !isPooled ? (
          <CommandButton
            icon="✓"
            primary
            disabled={busy}
            onClick={() => void resolveCase()}
          >
            {caseItem.decisionPath === "STP"
              ? "Confirm STP & Resolve"
              : "Approve & Resolve"}
          </CommandButton>
        ) : null}
        {!isLocked && !isPooled ? (
          <CommandButton
            icon="⟳"
            disabled={busy}
            onClick={() => setTab("Actions")}
          >
            Request Re-routing
          </CommandButton>
        ) : null}
        {isPooled ? (
          <Link className="command-button" href="/pool-queue">
            <span aria-hidden className="text-[15px] leading-none">
              ↗
            </span>
            Open in Pool Queue
          </Link>
        ) : null}
        <CommandDivider />
        <CommandButton icon="⟳" onClick={() => setCases(getCases())}>
          Refresh
        </CommandButton>
      </CommandBar>

      <RecordHeader
        recordType="Underwriting Case"
        title={caseItem.applicantName}
        status={`${STATUS_TEXT[caseItem.status]} — Saved`}
        subtitle={`${caseItem.productLine} · Age ${caseItem.age} · ${caseItem.occupation}`}
        facts={[
          { label: "Case ID", value: caseItem.id },
          {
            label: "Sum Assured",
            value: `$${caseItem.sumAssured.toLocaleString("en-US")}`,
          },
          {
            label: "Document Route",
            value: isPooled
              ? "POOL_QUEUE"
              : (caseItem.documentQuality?.route ?? "NOT_EVALUATED"),
          },
          {
            label: "Pool Queue Reason",
            value: caseItem.poolQueueReason ?? "—",
          },
          {
            label: "Underwriting Decision",
            value: caseItem.underwritingDecision ?? "NOT_EVALUATED",
          },
          {
            label: "Assignment status",
            value: caseItem.assigneeId ? "Assigned" : "Unassigned",
          },
          {
            label: "Care category",
            value: caseItem.careDecision?.category ?? "Not confirmed",
          },
          { label: "Assignee", value: assignee ? assignee.name : "Unassigned" },
          {
            label: "Engine",
            value:
              caseItem.provider === "gemini"
                ? "Gemini (live)"
                : "Deterministic",
          },
        ]}
      />

      {!caseItem.snapshotSignature && (
        <p className="m-4 rounded bg-blue-50 p-3">
          This is a preview calculated with the integrated rules.{" "}
          <Link className="underline" href="/mentor-demo">
            Run a mentor case
          </Link>{" "}
          to create a server-verified case with review actions.
        </p>
      )}
      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      <div className="tab-panels space-y-4 p-4 md:p-6">
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-semibold text-udred">
            {error}
          </p>
        ) : null}

        {/* All panels stay mounted and are toggled with `hidden` so switching tabs
            never unmounts/remounts a subtree -- that re-mount was what made the
            command bar and tab bar flicker (and occasionally throw) on fast switches. */}
        <div hidden={tab !== "Assessment"} role="tabpanel">
          <AssessmentTab caseItem={caseItem} />
        </div>
        <div hidden={tab !== "Documents"} role="tabpanel">
          <DocumentsTab
            extractions={caseItem.documentExtractions ?? []}
            ingestion={caseItem.ingestion ?? null}
          />
        </div>
        <div hidden={tab !== "Allocation Matrix"} role="tabpanel">
          <AllocationTab caseItem={caseItem} />
        </div>
        <div hidden={tab !== "Actions"} role="tabpanel">
          <ActionsTab
            busy={busy}
            caseItem={caseItem}
            assigneeName={assignee?.name ?? "the assignee"}
            rejectReason={rejectReason}
            rerouteReason={rerouteReason}
            onReject={() => void rejectCase()}
            onReroute={() => void requestReroute()}
            onResolve={() => void resolveCase()}
            setRejectReason={setRejectReason}
            setRerouteReason={setRerouteReason}
          />
        </div>
        <div hidden={tab !== "Audit"} role="tabpanel">
          <AuditTab caseItem={caseItem} />
        </div>
      </div>
    </>
  );
}

/* ---- Assessment ---------------------------------------------------------- */

function AssessmentTab({ caseItem }: { caseItem: UnderwritingCase }) {
  const complexity = caseItem.complexity;
  const displayedComplexityScore =
    complexity?.caseComplexityScore ?? complexity?.score ?? 0;
  return (
    <FormGrid cols={2}>
      <div className="space-y-4">
        <FormSection title="Case Scoring — Component A (Complexity Classifier)">
          {complexity ? (
            <>
              <div className="py-1">
                <p className="mb-1 text-[12px] text-muted">
                  Assessment scoring
                </p>
                <ScoreBar
                  band={complexity.band}
                  score={displayedComplexityScore}
                />
              </div>
              <FieldRow label="Reason code" locked>
                {formatComplexityReason(
                  displayedComplexityScore,
                  complexity.applicationComplexityScore,
                  complexity.clinicalComplexityScore,
                  complexity.driverFactors,
                )}
              </FieldRow>
              {complexity.driverFactors.length ? (
                <FieldRow label="Driver factors" locked>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {complexity.driverFactors.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </FieldRow>
              ) : null}
              <FieldRow label="Scoring engine" locked>
                {caseItem.provider === "gemini"
                  ? "Gemini (live LLM)"
                  : "Deterministic rule-based fallback"}
              </FieldRow>
              <FieldRow label="Application complexity" locked>
                {complexity.applicationComplexityScore}/10
              </FieldRow>
              <FieldRow label="Clinical complexity" locked>
                {complexity.clinicalComplexityScore}/10
              </FieldRow>
              <FieldRow label="Final case complexity" locked>
                {displayedComplexityScore}/10
              </FieldRow>
              <FieldRow label="Complexity confidence" locked>
                {Math.round(complexity.complexityConfidence * 100)}%
              </FieldRow>
              {complexity.complexityEvidence.length ? (
                <FieldRow label="Clinical complexity evidence" locked>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {complexity.complexityEvidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </FieldRow>
              ) : null}
            </>
          ) : (
            <p className="text-[13px] text-muted">Not scored yet.</p>
          )}
        </FormSection>
      </div>

      <div className="space-y-4">
        <FormSection title="NER Specialization — Component B">
          {caseItem.ner?.entities.length ? (
            <div className="space-y-1.5 py-1">
              {caseItem.ner.entities.map((e, i) => (
                <div
                  className="flex items-center gap-2 text-[13px]"
                  key={`${e.text}-${i}`}
                >
                  <StatusDot tone="blue" />
                  <span className="font-medium">&ldquo;{e.text}&rdquo;</span>
                  <span className="text-muted">→</span>
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-udblue">
                    {e.specialization}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted">
              No specialist medical/financial entities detected.
            </p>
          )}
          {caseItem.ner?.specialtiesRequired.length ? (
            <FieldRow label="Specialties required" locked>
              {caseItem.ner.specialtiesRequired.join(", ")}
            </FieldRow>
          ) : null}
          {caseItem.ner ? (
            <FieldRow label="NER confidence" locked>
              {Math.round(caseItem.ner.confidence * 100)}%
            </FieldRow>
          ) : null}
        </FormSection>
        <FormSection title="Strict medical-category gate">
          <p>
            {caseItem.careDecision?.reason ??
              "Not evaluated: complete the required evidence first."}
          </p>
          {caseItem.careEvidence &&
            Object.entries(caseItem.careEvidence).map(
              ([category, evidence]) => (
                <div key={category} className="mt-2">
                  <strong>
                    {category}: {evidence.state.replaceAll("_", " ")}
                  </strong>
                  {evidence.citations.map((q, i) => (
                    <p className="pl-3 text-muted" key={i}>
                      {q.documentId}: “{q.quote}”
                    </p>
                  ))}
                </div>
              ),
            )}
          <p className="mt-3 text-muted">
            Exactly one supported category and no uncertain categories may
            continue. The classifier uses conservative content rules; it is not
            a trained model.
          </p>
        </FormSection>
        {caseItem.documentQuality ? (
          <DocumentQualitySection evaluation={caseItem.documentQuality} />
        ) : null}

        {caseItem.missingFields.length > 0 ? (
          <FormSection
            title="Phase 1 — Completeness Check"
            className="border-l-2 border-l-udamber"
          >
            <FieldRow label="Missing fields" locked>
              <div className="flex flex-wrap gap-1.5">
                {caseItem.missingFields.map((f) => (
                  <span
                    className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-udamber"
                    key={f}
                  >
                    {f}
                  </span>
                ))}
              </div>
            </FieldRow>
            <FieldRow label="Auto-drafted follow-up" locked>
              {caseItem.followUpMessage}
            </FieldRow>
          </FormSection>
        ) : (
          <FormSection title="Phase 1 — Completeness Check">
            <p className="flex items-center gap-2 text-[13px] text-udgreen">
              <StatusDot tone="green" /> Application package is complete.
            </p>
          </FormSection>
        )}
      </div>
    </FormGrid>
  );
}

function DocumentQualitySection({
  evaluation,
}: {
  evaluation: NonNullable<UnderwritingCase["documentQuality"]>;
}) {
  const passed = evaluation.validationStatus === "PASSED";
  // Cases saved by older builds do not have the newer explainability arrays. Keep old localStorage
  // records viewable after the evaluator schema evolves.
  const matchedEvidence = evaluation.matchedEvidence ?? [];
  const extractedEvidence = evaluation.extractedEvidence ?? [];
  const readabilityProblems = evaluation.readabilityProblems ?? [];
  const scoreBreakdown = evaluation.scoreBreakdown ?? [];
  const scoreAdjustments = scoreBreakdown.filter((item) =>
    /penalt|cap|adjustment/i.test(item.dimension),
  );
  const fieldEvaluations = evaluation.fieldEvaluations ?? [];
  const semanticMatchScore = evaluation.semanticMatchScore ?? 0;
  const contradictions = ((evaluation.contradictions ?? []) as unknown[]).map(
    (item) =>
      typeof item === "string"
        ? {
            code: "INTERNAL_CONTRADICTION",
            message: item,
            penalty: 0,
            sourceFields: [],
          }
        : (item as {
            code: string;
            message: string;
            penalty: number;
            sourceFields: string[];
          }),
  );
  return (
    <FormSection
      title="Document Quality & Validity Gate"
      className={
        passed ? "border-l-2 border-l-udgreen" : "border-l-2 border-l-udred"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p
            className={`text-[17px] font-semibold ${passed ? "text-udgreen" : "text-udred"}`}
          >
            {evaluation.score}/10 · {evaluation.validationStatus}
          </p>
          <p className="text-[12px] text-muted">
            Detected profile: {evaluation.detectedMedicalProfile}
          </p>
        </div>
        <span
          className={`rounded px-2 py-1 text-[11px] font-semibold ${passed ? "bg-green-50 text-udgreen" : "bg-red-50 text-udred"}`}
        >
          {evaluation.route === "CONTINUE_CHECKS" ||
          evaluation.route === "AUTO_ASSIGN"
            ? "May continue to assignment"
            : "Pool Queue required"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] md:grid-cols-4">
        <span>
          Completeness: <strong>{evaluation.completenessScore}/10</strong>
        </span>
        <span>
          Consistency: <strong>{evaluation.consistencyScore}/10</strong>
        </span>
        <span>
          Readability: <strong>{evaluation.readabilityScore}/10</strong>
        </span>
        <span>
          Confidence (heuristic):{" "}
          <strong>{Math.round(evaluation.evaluatorConfidence * 100)}%</strong>
        </span>
        <span>
          Profile match (heuristic):{" "}
          <strong>{Math.round(semanticMatchScore * 100)}%</strong>
        </span>
      </div>
      {fieldEvaluations.length ? (
        <FieldRow label="Field status" locked>
          <div className="grid gap-1">
            {fieldEvaluations.map((item) => (
              <div className="rounded bg-slate-50 px-2 py-1" key={item.field}>
                <strong>
                  {item.label}: {item.status}
                </strong>{" "}
                <span className="text-muted">
                  ({item.points} point) — {item.reason}
                </span>
              </div>
            ))}
          </div>
        </FieldRow>
      ) : null}
      {evaluation.completeFields?.length ? (
        <FieldRow label="Complete fields" locked>
          {evaluation.completeFields.join(", ")}
        </FieldRow>
      ) : null}
      {evaluation.partialFields?.length ? (
        <FieldRow label="Partial / incomplete fields" locked>
          {evaluation.partialFields.join(", ")}
        </FieldRow>
      ) : null}
      {evaluation.missingFields.length ? (
        <FieldRow label="Missing fields" locked>
          {evaluation.missingFields.join(", ")}
        </FieldRow>
      ) : null}
      {evaluation.notApplicableFields?.length ? (
        <FieldRow label="Not applicable fields" locked>
          {evaluation.notApplicableFields.join(", ")}
        </FieldRow>
      ) : null}
      {contradictions.length ? (
        <FieldRow label="Contradictions / review flags" locked>
          <ul className="list-disc space-y-0.5 pl-4 text-udred">
            {contradictions.map((item) => (
              <li key={`${item.code}-${item.message}`}>
                {item.code}: {item.message} (-{item.penalty})
                {item.sourceFields.length
                  ? ` [${item.sourceFields.join(", ")}]`
                  : ""}
              </li>
            ))}
          </ul>
        </FieldRow>
      ) : null}
      <FieldRow label="Matched evidence" locked>
        {evaluation.matchedReferenceFields.join(", ") ||
          "No reliable reference match"}
      </FieldRow>
      {matchedEvidence.length ? (
        <FieldRow label="Profile evidence" locked>
          <ul className="list-disc space-y-0.5 pl-4">
            {matchedEvidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </FieldRow>
      ) : null}
      {evaluation.semanticEvidence?.length ? (
        <FieldRow label="Semantic evidence" locked>
          <ul className="list-disc space-y-0.5 pl-4 text-[12px]">
            {evaluation.semanticEvidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </FieldRow>
      ) : null}
      {evaluation.reasonCodes?.length ? (
        <FieldRow label="Reason codes" locked>
          {evaluation.reasonCodes.join(", ")}
        </FieldRow>
      ) : null}
      {extractedEvidence.length ? (
        <FieldRow label="Extracted evidence" locked>
          <ul className="list-disc space-y-0.5 pl-4 text-[12px]">
            {extractedEvidence.slice(0, 8).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </FieldRow>
      ) : null}
      {readabilityProblems.length ? (
        <FieldRow label="Readability problems" locked>
          <span className="text-udred">{readabilityProblems.join(" ")}</span>
        </FieldRow>
      ) : null}
      <FieldRow label="Score calculation" locked>
        <div className="grid gap-0.5 text-[12px]">
          <div className="flex justify-between gap-3">
            <span>Base dimension score</span>
            <strong>{evaluation.baseScore ?? "—"}</strong>
          </div>
          {scoreAdjustments.map((item) => (
            <div className="flex justify-between gap-3" key={item.dimension}>
              <span>{item.dimension}</span>
              <strong>
                {item.points > 0 ? "+" : ""}
                {item.points}
              </strong>
            </div>
          ))}
          <div className="mt-1 border-t border-line pt-1 font-semibold">
            Final document score: {evaluation.score}/10
          </div>
        </div>
      </FieldRow>
      <FieldRow label="Evaluator engine" locked>
        {evaluation.engineUsed === "gemini"
          ? "Gemini"
          : "Deterministic fallback"}
      </FieldRow>
    </FormSection>
  );
}

/* ---- Allocation Matrix ------------------------------------------------- */

function AllocationTab({ caseItem }: { caseItem: UnderwritingCase }) {
  return (
    <FormSection title="Component C — Filter Node + Optimization Node">
      <p className="mb-3 text-[13px] text-muted">{caseItem.match?.rationale}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wide text-muted">
              <th className="py-2 pr-3">Underwriter</th>
              <th className="py-2 pr-3">Rank</th>
              <th className="py-2 pr-3">Eligible</th>
              <th className="py-2">Policy checks</th>
            </tr>
          </thead>
          <tbody>
            {caseItem.match?.evaluations
              .slice()
              .sort((a, b) => (a.matchRank || 999) - (b.matchRank || 999))
              .map((evalItem) => {
                const uw = underwriterRegistry.find(
                  (u) => u.id === evalItem.underwriterId,
                );
                const isChosen = caseItem.assigneeId === evalItem.underwriterId;
                return (
                  <tr
                    className={`border-b border-line align-top ${isChosen ? "bg-blue-50/60" : ""}`}
                    key={evalItem.underwriterId}
                  >
                    <td className="py-2.5 pr-3 font-medium">
                      {uw?.name ?? evalItem.underwriterId}
                      {isChosen ? (
                        <span className="ml-2 rounded bg-udblue px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          CHOSEN
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3">{evalItem.matchRank || "—"}</td>
                    <td className="py-2.5 pr-3">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot tone={evalItem.eligible ? "green" : "red"} />
                        {evalItem.eligible ? "Eligible" : "Excluded"}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <div className="grid gap-1">
                        {evalItem.policies.map((p) => (
                          <div
                            className="flex items-start gap-2"
                            key={p.policy}
                          >
                            <span
                              className={`mt-px text-[11px] font-semibold ${p.passed ? "text-udgreen" : "text-udred"}`}
                            >
                              {p.passed ? "PASS" : "FAIL"}
                            </span>
                            <span className="text-[12px] text-muted">
                              <strong className="text-ink">{p.policy}:</strong>{" "}
                              {p.detail}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </FormSection>
  );
}

/* ---- Actions --------------------------------------------------------- */

function ActionsTab({
  caseItem,
  assigneeName,
  busy,
  rerouteReason,
  rejectReason,
  setRerouteReason,
  setRejectReason,
  onResolve,
  onReroute,
  onReject,
}: {
  caseItem: UnderwritingCase;
  assigneeName: string;
  busy: boolean;
  rerouteReason: string;
  rejectReason: string;
  setRerouteReason: (v: string) => void;
  setRejectReason: (v: string) => void;
  onResolve: () => void;
  onReroute: () => void;
  onReject: () => void;
}) {
  if (caseItem.status === "RESOLVED") {
    return (
      <FormSection title="Decision Recorded">
        <p className="text-[13px] text-muted">
          This case is resolved. See the Audit tab for the full decision trail.
        </p>
      </FormSection>
    );
  }

  if (caseItem.status === "POOL_QUEUE") {
    return (
      <FormSection title="Escalated">
        <p className="text-[13px] text-udred">
          No qualifying underwriter was found. This case is in the Pool Queue —
          go to{" "}
          <Link className="font-semibold underline" href="/pool-queue">
            Pool Queue
          </Link>{" "}
          for Operations Manager manual override.
        </p>
      </FormSection>
    );
  }

  return (
    <FormGrid cols={3}>
      <FormSection title="Approve match">
        <ul className="mb-3 grid gap-1.5 text-[13px]">
          <li className="rounded border border-line bg-slate-50 p-2">
            Reclassification: confirm complexity band matches file contents.
          </li>
          <li className="rounded border border-line bg-slate-50 p-2">
            Review checklist: verify authority limit &amp; specialization match.
          </li>
          <li className="rounded border border-line bg-slate-50 p-2">
            Audit: inspect the full AI decision trace in the Audit tab.
          </li>
        </ul>
        <p className="mb-3 text-[12px] text-muted">
          <strong className="text-ink">Resolve</strong> means you agree{" "}
          {assigneeName} is the right underwriter and you&rsquo;re closing the
          case out of the active queue. It does not sign off the Filter Node
          policy checks one by one — those are automatic facts.
        </p>
        <button
          className="primary-button w-full"
          disabled={busy}
          onClick={onResolve}
          type="button"
        >
          {caseItem.decisionPath === "STP"
            ? "Confirm STP assignment & Resolve"
            : "Approve match & Resolve"}
        </button>
      </FormSection>

      <FormSection title="Disagree? Re-route">
        <p className="mb-2 text-[13px] text-muted">
          AI misjudged complexity or specialty — ask it to find a different
          underwriter, excluding the current assignee.
        </p>
        <textarea
          className="field-input mb-3 min-h-24"
          onChange={(e) => setRerouteReason(e.target.value)}
          placeholder="e.g. Opened the file, found an additional cardiology complication not disclosed at intake."
          value={rerouteReason}
        />
        <button
          className="ghost-button w-full"
          disabled={busy}
          onClick={onReroute}
          type="button"
        >
          {busy ? "Re-routing…" : "Request AI Re-routing"}
        </button>
      </FormSection>

      <FormSection
        title="Reject outright"
        className="border-l-2 border-l-udred"
      >
        <p className="mb-2 text-[13px] text-muted">
          No automated candidate is right at all — skip re-matching and send
          straight to the Pool Queue for an Ops Manager to hand-pick.
        </p>
        <textarea
          className="field-input mb-3 min-h-24"
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="e.g. This needs a specific underwriter's sign-off that the matrix doesn't capture."
          value={rejectReason}
        />
        <button
          className="danger-button w-full"
          disabled={busy}
          onClick={onReject}
          type="button"
        >
          {busy ? "Rejecting…" : "Reject & send to Pool Queue"}
        </button>
      </FormSection>
    </FormGrid>
  );
}

/* ---- Audit --------------------------------------------------------- */

function AuditTab({ caseItem }: { caseItem: UnderwritingCase }) {
  return (
    <FormSection title="Explainability — Audit trail for this case">
      <div className="grid gap-1.5">
        {caseItem.audit
          .slice()
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .map((event) => (
            <div
              className="rounded border border-line bg-slate-50 p-2.5 text-[13px]"
              key={event.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  <span
                    className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      event.actor === "ai"
                        ? "bg-blue-50 text-udblue"
                        : event.actor === "human"
                          ? "bg-purple-50 text-udpurple"
                          : "bg-slate-200 text-muted"
                    }`}
                  >
                    {event.actor.toUpperCase()}
                  </span>
                  {event.action}
                </p>
                <p className="text-[11px] text-muted">
                  {new Date(event.createdAt).toLocaleString()}
                </p>
              </div>
              <p className="mt-1 text-muted">{event.detail}</p>
            </div>
          ))}
      </div>
    </FormSection>
  );
}

/* ---- Documents --------------------------------------------------- */

const FIELD_LABELS: Partial<Record<keyof ExtractedFields, string>> = {
  age: "Age",
  sumAssured: "Sum Assured",
  occupation: "Occupation",
  productLine: "Product line",
  smoker: "Smoker",
  packsPerWeek: "Packs/week",
  heightCm: "Height (cm)",
  weightKg: "Weight (kg)",
  bmi: "BMI",
  annualIncome: "Annual income",
  maritalStatus: "Marital status",
  medicalConditions: "Conditions",
  medications: "Medications",
  dangerousSports: "Dangerous sports",
  disclosuresText: "Disclosures",
  medicalSummary: "Clinical summary",
};

function fieldChips(fields: ExtractedFields) {
  return (Object.entries(fields) as [keyof ExtractedFields, unknown][])
    .filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0))
    .map(([key, v]) => {
      const label = FIELD_LABELS[key] ?? key;
      const value = Array.isArray(v)
        ? v.join(", ")
        : typeof v === "boolean"
          ? v
            ? "yes"
            : "no"
          : String(v);
      return { key, label, value };
    });
}

function DocumentsTab({
  extractions,
  ingestion,
}: {
  extractions: DocumentExtraction[];
  ingestion: UnderwritingCase["ingestion"];
}) {
  if (!extractions.length) {
    return (
      <FormSection title="Phase 1 — Data Ingestion Engine">
        <p className="text-[13px] text-muted">
          No supporting documents were attached to this application.
        </p>
      </FormSection>
    );
  }

  const reconciled = ingestion?.mode === "reconciled";

  return (
    <FormSection title="Phase 1 — Data Ingestion Engine">
      <p className="mb-3 text-[13px] text-muted">
        {reconciled
          ? "OCR ran when the documents were attached. The submitter reconciled each difference before intake — see below and in the Audit tab."
          : "Uploaded files are parsed before scoring. Document values override the intake form; every change is listed below and in the Audit tab."}
      </p>

      <div className="grid gap-2.5">
        {extractions.map((doc) => {
          const chips = fieldChips(doc.fields);
          return (
            <div
              className="rounded border border-line bg-slate-50 p-3"
              key={doc.fileName}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{doc.fileName}</span>
                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                  {doc.kind}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    doc.provider === "gemini"
                      ? "bg-blue-50 text-udblue"
                      : "bg-amber-50 text-udamber"
                  }`}
                >
                  {doc.provider === "gemini" ? "Gemini vision" : "Offline stub"}
                </span>
                {doc.source ? (
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                    Source: {doc.source}
                  </span>
                ) : null}
                {doc.documentSessionId ? (
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                    Session: {doc.documentSessionId.slice(-8)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-[12px] text-muted">{doc.summary}</p>
              {chips.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <span
                      className="rounded border border-line bg-white px-1.5 py-0.5 text-[11px]"
                      key={String(c.key)}
                    >
                      <strong className="text-ink">{c.label}:</strong>{" "}
                      <span className="text-muted">{c.value}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {doc.warnings.length ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-udamber">
                  {doc.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      {ingestion &&
      (ingestion.filledFields.length > 0 ||
        ingestion.overriddenFields.length > 0 ||
        (ingestion.reconciliation?.keptOwn.length ?? 0) > 0 ||
        ingestion.appendedToMedicalHistory) ? (
        <div className="mt-3 grid gap-1.5 rounded border-l-2 border-udblue bg-blue-50 p-3 text-[13px]">
          {ingestion.filledFields.length ? (
            <p>
              <strong>Auto-filled from documents:</strong>{" "}
              {ingestion.filledFields.join(", ")}.
            </p>
          ) : null}
          {ingestion.overriddenFields.map((o) => (
            <p key={`${o.field}-${o.to}`}>
              <strong>
                {reconciled ? "Aligned to document:" : "Overridden:"}
              </strong>{" "}
              {o.field}{" "}
              <span className="text-muted">&ldquo;{o.from}&rdquo; →</span>{" "}
              &ldquo;{o.to}&rdquo;{" "}
              <span className="text-muted">(source: {o.source})</span>
            </p>
          ))}
          {(ingestion.reconciliation?.keptOwn ?? []).map((k) => (
            <p key={`kept-${k.field}`}>
              <strong>Mismatch kept:</strong> {k.field} — submitter kept &ldquo;
              {k.userValue}&rdquo; over document &ldquo;{k.documentValue}&rdquo;{" "}
              <span className="text-muted">(source: {k.source})</span>
            </p>
          ))}
          {ingestion.appendedToMedicalHistory ? (
            <p>
              Document medical findings were merged into the medical history.
            </p>
          ) : null}
        </div>
      ) : null}
    </FormSection>
  );
}
