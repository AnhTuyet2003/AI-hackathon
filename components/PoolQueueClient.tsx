"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ComplexityBadge } from "@/components/Badges";
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
    <div>
      <header>
        <p className="eyebrow">Escalation Policy</p>
        <h1 className="mt-1 text-3xl font-black">Pool Queue -- Operations Manager override</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Cases land here when no underwriter passes all gating policies (e.g. a score-10 case while every qualified Medical/Senior underwriter is over
          capacity or offline). The Ops Manager picks a manual override here.
        </p>
      </header>

      <section className="mt-6 grid gap-4">
        {pooled.length === 0 ? (
          <div className="shell-card p-6 text-sm text-muted">Pool Queue is empty -- no escalated cases right now.</div>
        ) : null}

        {pooled.map((c) => (
          <div className="shell-card p-5" key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link className="text-sm font-black text-udblue hover:underline" href={`/cases/${c.id}`}>
                  {c.id}
                </Link>
                <h2 className="mt-1 text-xl font-black">{c.applicantName}</h2>
                <p className="mt-1 text-sm text-muted">
                  Sum Assured ${c.sumAssured.toLocaleString("en-US")} | {c.occupation}
                </p>
              </div>
              {c.complexity ? <ComplexityBadge band={c.complexity.band} score={c.complexity.score} /> : null}
            </div>

            <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-udred">{c.match?.rationale}</div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="field-label">
                Manually assign underwriter
                <select
                  className="field-input"
                  onChange={(e) => setSelections((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  value={selections[c.id] ?? ""}
                >
                  <option value="">Select underwriter...</option>
                  {underwriterRegistry.map((uw) => (
                    <option key={uw.id} value={uw.id}>
                      {uw.name} ({uw.tier}, queue {uw.currentQueueLoad})
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-button" disabled={!selections[c.id] || busyId === c.id} onClick={() => void override(c)} type="button">
                {busyId === c.id ? "Assigning..." : "Confirm manual override"}
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
