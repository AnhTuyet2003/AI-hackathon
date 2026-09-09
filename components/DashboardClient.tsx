"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ComplexityBadge, StatusBadge } from "@/components/Badges";
import { CommandBar, CommandButton, CommandDivider, FormSection, RecordHeader } from "@/components/ModelDriven";
import { StatCard } from "@/components/StatCard";
import { getCases, resetCases } from "@/lib/local-store";
import { underwriterRegistry } from "@/lib/underwriters";
import type { UnderwritingCase } from "@/lib/types";

const PAGE_SIZE = 8;

export function DashboardClient() {
  const [cases, setCases] = useState<UnderwritingCase[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setCases(getCases());
  }, []);

  const pageCount = Math.max(1, Math.ceil(cases.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleCases = cases.slice(pageStart, pageStart + PAGE_SIZE);

  const stats = useMemo(() => {
    const stp = cases.filter((c) => c.decisionPath === "STP").length;
    const manual = cases.filter((c) => c.decisionPath === "MANUAL").length;
    const poolQueue = cases.filter((c) => c.status === "POOL_QUEUE").length;
    return { total: cases.length, stp, manual, poolQueue };
  }, [cases]);

  function handleReset() {
    setCases(resetCases());
    setPage(1);
  }

  return (
    <>
      <CommandBar>
        <Link className="command-button-primary" href="/submit">
          <span aria-hidden className="text-[15px] leading-none">＋</span>
          Submit Application
        </Link>
        <CommandDivider />
        <CommandButton icon="⟳" onClick={() => setCases(getCases())}>
          Refresh
        </CommandButton>
        <CommandButton icon="↺" onClick={handleReset}>
          Reset demo data
        </CommandButton>
      </CommandBar>

      <RecordHeader
        recordType="Underwriting queue"
        title="AI-Underwriting Dispatcher"
        subtitle="Intelligent workload balancing & skill-based automated routing — cases move from PENDING to STP auto-assignment, a manual review match, or the Pool Queue within minutes."
        facts={[
          { label: "Total", value: stats.total },
          { label: "STP", value: stats.stp },
          { label: "Manual", value: stats.manual },
          { label: "Pool Queue", value: stats.poolQueue }
        ]}
      />

      <div className="space-y-4 p-4 md:p-6">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total cases" value={stats.total} tone="blue" />
          <StatCard label="Auto-assigned (STP)" value={stats.stp} tone="green" />
          <StatCard label="Manual review" value={stats.manual} tone="amber" />
          <StatCard label="Pool Queue" value={stats.poolQueue} tone="red" />
        </section>

        <FormSection title="Underwriter Registry — Smart Allocation Matrix capacity snapshot">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">Underwriter</th>
                  <th className="py-2 pr-3">Authority Limit</th>
                  <th className="py-2 pr-3">Specialization</th>
                  <th className="py-2 pr-3">Queue Load</th>
                  <th className="py-2">Availability</th>
                </tr>
              </thead>
              <tbody>
                {underwriterRegistry.map((uw) => (
                  <tr className="border-b border-line" key={uw.id}>
                    <td className="py-2 pr-3 font-medium">
                      {uw.name} <span className="text-muted">({uw.tier})</span>
                    </td>
                    <td className="py-2 pr-3">{uw.authorityLimit === null ? "Unlimited" : `$${uw.authorityLimit.toLocaleString("en-US")}`}</td>
                    <td className="py-2 pr-3">{uw.specializationTags.join(", ")}</td>
                    <td className="py-2 pr-3">{uw.currentQueueLoad} cases</td>
                    <td className="py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                          uw.availability === "active" ? "bg-green-50 text-udgreen" : "bg-red-50 text-udred"
                        }`}
                      >
                        {uw.availability === "active" ? "Active" : uw.availability === "dnd" ? "In Meeting (DND)" : "Offline"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>

        <FormSection title="Case queue — all cases">
          {cases.length > 0 ? (
            <p className="mb-2 text-[11px] text-muted">
              Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, cases.length)} of {cases.length}
            </p>
          ) : null}
          <div className="grid gap-1.5">
            {cases.length === 0 ? (
              <p className="text-[13px] text-muted">No cases yet — submit a new application to see the pipeline run.</p>
            ) : null}
            {visibleCases.map((c) => {
              const assignee = c.assigneeId ? underwriterRegistry.find((u) => u.id === c.assigneeId) : null;
              return (
                <Link
                  className="flex flex-col gap-1.5 rounded border border-line bg-white p-3 transition hover:border-udblue md:flex-row md:items-center md:justify-between"
                  href={`/cases/${c.id}`}
                  key={c.id}
                >
                  <div>
                    <p className="text-[13px] font-semibold">
                      {c.id} — {c.applicantName}
                    </p>
                    <p className="text-[11px] text-muted">
                      {c.productLine} · Sum Assured ${c.sumAssured.toLocaleString("en-US")} ·{" "}
                      {assignee ? `Assignee: ${assignee.name}` : "Unassigned"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.complexity ? <ComplexityBadge band={c.complexity.band} score={c.complexity.score} /> : null}
                    <StatusBadge status={c.status} />
                  </div>
                </Link>
              );
            })}
          </div>

          {pageCount > 1 ? (
            <nav className="mt-3 flex items-center justify-between gap-2" aria-label="Case queue pagination">
              <button
                className="ghost-button px-2.5 py-1 text-[12px]"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                type="button"
              >
                Previous
              </button>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                  <button
                    aria-current={n === currentPage ? "page" : undefined}
                    className={`h-7 w-7 rounded border text-[12px] font-semibold transition ${
                      n === currentPage ? "border-udblue bg-udblue text-white" : "border-line bg-white text-ink hover:bg-slate-50"
                    }`}
                    key={n}
                    onClick={() => setPage(n)}
                    type="button"
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button
                className="ghost-button px-2.5 py-1 text-[12px]"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
                type="button"
              >
                Next
              </button>
            </nav>
          ) : null}
        </FormSection>
      </div>
    </>
  );
}
