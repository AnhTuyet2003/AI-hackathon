"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ComplexityBadge, StatusBadge } from "@/components/Badges";
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
    const escalated = cases.filter((c) => c.decisionPath === "ESCALATED").length;
    return { total: cases.length, stp, manual, escalated };
  }, [cases]);

  function handleReset() {
    setCases(resetCases());
    setPage(1);
  }

  return (
    <div>
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="eyebrow">Underwriting queue</p>
          <h1 className="mt-1 text-3xl font-black">AI-Underwriting Dispatcher</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Intelligent workload balancing &amp; skill-based automated routing -- cases move from PENDING to an auto-assignment (STP), a manual
            review match, or the Pool Queue within minutes.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="ghost-button" onClick={handleReset} type="button">
            Reset demo data
          </button>
          <Link className="primary-button" href="/submit">
            + Submit Application
          </Link>
        </div>
      </header>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total cases" value={stats.total} tone="blue" />
        <StatCard label="Auto-assigned (STP)" value={stats.stp} tone="green" />
        <StatCard label="Manual review" value={stats.manual} tone="amber" />
        <StatCard label="Pool Queue (escalated)" value={stats.escalated} tone="red" />
      </section>

      <section className="mt-6 shell-card p-5">
        <p className="eyebrow">Underwriter Registry</p>
        <h2 className="mt-1 text-xl font-black">Smart Allocation Matrix -- capacity snapshot</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-wide text-muted">
                <th className="pb-2">Underwriter</th>
                <th className="pb-2">Authority Limit</th>
                <th className="pb-2">Specialization</th>
                <th className="pb-2">Queue Load</th>
                <th className="pb-2">Availability</th>
              </tr>
            </thead>
            <tbody>
              {underwriterRegistry.map((uw) => (
                <tr className="border-t border-line" key={uw.id}>
                  <td className="py-2 font-bold">
                    {uw.name} <span className="text-muted">({uw.tier})</span>
                  </td>
                  <td className="py-2">{uw.authorityLimit === null ? "Unlimited" : `$${uw.authorityLimit.toLocaleString("en-US")}`}</td>
                  <td className="py-2">{uw.specializationTags.join(", ")}</td>
                  <td className="py-2">{uw.currentQueueLoad} cases</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-black ${
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
      </section>

      <section className="mt-6 shell-card p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="eyebrow">Case queue</p>
            <h2 className="mt-1 text-xl font-black">All cases</h2>
          </div>
          {cases.length > 0 ? (
            <p className="text-xs text-muted">
              Showing {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, cases.length)} of {cases.length}
            </p>
          ) : null}
        </div>
        <div className="grid gap-3">
          {cases.length === 0 ? <p className="text-sm text-muted">No cases yet -- submit a new application to see the pipeline run.</p> : null}
          {visibleCases.map((c) => {
            const assignee = c.assigneeId ? underwriterRegistry.find((u) => u.id === c.assigneeId) : null;
            return (
              <Link
                className="flex flex-col gap-2 rounded-lg border border-line bg-white p-4 transition hover:border-udblue md:flex-row md:items-center md:justify-between"
                href={`/cases/${c.id}`}
                key={c.id}
              >
                <div>
                  <p className="text-sm font-black">
                    {c.id} -- {c.applicantName}
                  </p>
                  <p className="text-xs text-muted">
                    {c.productLine} | Sum Assured ${c.sumAssured.toLocaleString("en-US")} | {assignee ? `Assignee: ${assignee.name}` : "Unassigned"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {c.complexity ? <ComplexityBadge band={c.complexity.band} score={c.complexity.score} /> : null}
                  <StatusBadge status={c.status} />
                </div>
              </Link>
            );
          })}
        </div>

        {pageCount > 1 ? (
          <nav className="mt-4 flex items-center justify-between gap-2" aria-label="Case queue pagination">
            <button
              className="ghost-button px-3 py-1.5 text-xs"
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
                  className={`h-8 w-8 rounded-lg border text-xs font-bold transition ${
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
              className="ghost-button px-3 py-1.5 text-xs"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
              type="button"
            >
              Next
            </button>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
