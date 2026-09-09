"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ComplexityBadge } from "@/components/Badges";
import { CommandBar, CommandButton, FormSection, RecordHeader } from "@/components/ModelDriven";
import { getCases, saveCases } from "@/lib/local-store";
import { underwriterRegistry } from "@/lib/underwriters";
import type { UnderwritingCase } from "@/lib/types";

export function PoolQueueClient() {
  const [cases, setCases] = useState<UnderwritingCase[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setCases(getCases());
  }, []);

  const pooled = cases.filter((c) => c.status === "POOL_QUEUE");

  async function override(caseItem: UnderwritingCase) {
    const underwriterId = selections[caseItem.id];
    if (!underwriterId) return;
    setBusyId(caseItem.id);
    try {
      const response = await fetch("/api/cases/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case: caseItem, underwriterId, note: "Ops Manager manually overrode Pool Queue assignment." })
      });
      const payload = (await response.json()) as { case?: UnderwritingCase };
      if (!payload.case) return;
      const next = cases.map((c) => (c.id === payload.case!.id ? payload.case! : c));
      setCases(next);
      saveCases(next);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <CommandBar>
        <Link className="command-button" href="/">
          <span aria-hidden className="text-[15px] leading-none">←</span>
          Dashboard
        </Link>
        <CommandButton icon="⟳" onClick={() => setCases(getCases())}>
          Refresh
        </CommandButton>
      </CommandBar>

      <RecordHeader
        recordType="Escalation Policy"
        title="Pool Queue — Operations Manager override"
        subtitle="Cases land here when no underwriter passes all gating policies (e.g. a score-10 case while every qualified Medical/Senior underwriter is over capacity or offline). The Ops Manager picks a manual override here."
        facts={[{ label: "Escalated cases", value: pooled.length }]}
      />

      <div className="space-y-4 p-4 md:p-6">
        {pooled.length === 0 ? (
          <FormSection title="Queue">
            <p className="text-[13px] text-muted">Pool Queue is empty — no escalated cases right now.</p>
          </FormSection>
        ) : null}

        {pooled.map((c) => (
          <FormSection key={c.id} title={`${c.id} — ${c.applicantName}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-[13px] text-muted">
                Sum Assured ${c.sumAssured.toLocaleString("en-US")} · {c.occupation}
              </p>
              {c.complexity ? <ComplexityBadge band={c.complexity.band} score={c.complexity.score} /> : null}
            </div>

            <div className="mt-3 rounded border-l-2 border-udred bg-red-50 p-2.5 text-[13px] text-udred">
              {c.poolQueueReason ? <p><strong>Primary reason:</strong> {formatPoolReason(c.poolQueueReason)}</p> : null}
              {c.documentQuality?.validationStatus === "FAILED" ? (
                <>
                  <strong>Document validation failed: {c.documentQuality.score}/10.</strong>{" "}
                  {c.documentQuality.missingFields.length ? `Missing or incomplete: ${c.documentQuality.missingFields.join(", ")}.` : "Review the document quality findings."}
                </>
              ) : null}
              {c.documentQuality?.validationStatus === "FAILED" && c.match?.rationale ? " " : null}
              {c.match?.rationale}
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="field-label">
                Manually assign underwriter
                <select
                  className="field-input min-w-[240px]"
                  onChange={(e) => setSelections((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  value={selections[c.id] ?? ""}
                >
                  <option value="">Select underwriter…</option>
                  {underwriterRegistry.map((uw) => (
                    <option key={uw.id} value={uw.id}>
                      {uw.name} ({uw.tier}, queue {uw.currentQueueLoad})
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary-button"
                disabled={!selections[c.id] || busyId === c.id}
                onClick={() => void override(c)}
                type="button"
              >
                {busyId === c.id ? "Assigning…" : "Confirm manual override"}
              </button>
              <Link className="ghost-button" href={`/cases/${c.id}`}>
                Open case
              </Link>
            </div>
          </FormSection>
        ))}
      </div>
    </>
  );
}

function formatPoolReason(reason: NonNullable<UnderwritingCase["poolQueueReason"]>) {
  return reason.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}
