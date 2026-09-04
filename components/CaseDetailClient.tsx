"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ComplexityBadge, StatusBadge } from "@/components/Badges";
import { getCases, saveCases } from "@/lib/local-store";
import { underwriterRegistry } from "@/lib/underwriters";
import type { UnderwritingCase } from "@/lib/types";

export function CaseDetailClient({ caseId }: { caseId: string }) {
  const [cases, setCases] = useState<UnderwritingCase[]>([]);
  const caseItem = useMemo(() => cases.find((c) => c.id === caseId), [caseId, cases]);
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
          reason: rerouteReason || "Underwriter opened the file and found hidden complexities.",
          excludeUnderwriterId: caseItem.assigneeId ?? undefined
        })
      });
      const payload = (await response.json()) as { case?: UnderwritingCase; error?: string };
      if (!response.ok || !payload.case) throw new Error(payload.error || "Re-routing failed.");
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
        body: JSON.stringify({ case: caseItem, note: "Underwriter confirmed and resolved the case." })
      });
      const payload = (await response.json()) as { case?: UnderwritingCase; error?: string };
      if (!response.ok || !payload.case) throw new Error(payload.error || "Resolve failed.");
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
        body: JSON.stringify({ case: caseItem, reason: rejectReason || "Underwriter rejected the AI-suggested assignment outright." })
      });
      const payload = (await response.json()) as { case?: UnderwritingCase; error?: string };
      if (!response.ok || !payload.case) throw new Error(payload.error || "Reject failed.");
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
      <div className="shell-card p-8">
        <h1 className="text-2xl font-black">Case not found</h1>
        <p className="mt-2 text-muted">The case may not exist in local demo storage.</p>
        <Link className="primary-button mt-5 inline-flex" href="/">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const assignee = caseItem.assigneeId ? underwriterRegistry.find((u) => u.id === caseItem.assigneeId) : null;
  const isLocked = caseItem.status === "RESOLVED";

  return (
    <div>
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="eyebrow">{caseItem.id}</p>
          <h1 className="mt-1 text-3xl font-black">{caseItem.applicantName}</h1>
          <p className="mt-2 text-sm text-muted">
            {caseItem.productLine} | Age {caseItem.age} | {caseItem.occupation}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {caseItem.complexity ? <ComplexityBadge band={caseItem.complexity.band} score={caseItem.complexity.score} /> : null}
          <StatusBadge status={caseItem.status} />
        </div>
      </header>

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <Info label="Sum Assured" value={`$${caseItem.sumAssured.toLocaleString("en-US")}`} />
        <Info label="Decision Path" value={caseItem.decisionPath ?? "--"} />
        <Info label="Assignee" value={assignee ? `${assignee.name} (${assignee.tier})` : "Unassigned"} />
        <Info label="Engine" value={caseItem.provider === "gemini" ? "Gemini (live)" : "Deterministic fallback"} />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="shell-card p-5">
          <p className="eyebrow">Component A -- Complexity Classifier</p>
          <h2 className="mt-1 text-xl font-black">Reason Code</h2>
          <p className="mt-4 rounded-lg border-l-4 border-udblue bg-blue-50 p-4 leading-7">{caseItem.complexity?.reasonCode}</p>
          {caseItem.complexity?.driverFactors.length ? (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm leading-6">
              {caseItem.complexity.driverFactors.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="shell-card p-5">
          <p className="eyebrow">Component B -- NER Specialization</p>
          <h2 className="mt-1 text-xl font-black">Extracted Entities</h2>
          {caseItem.ner?.entities.length ? (
            <div className="mt-4 grid gap-2">
              {caseItem.ner.entities.map((e, i) => (
                <div className="rounded-lg border border-line bg-slate-50 p-3 text-sm" key={`${e.text}-${i}`}>
                  <span className="font-bold">"{e.text}"</span> <span className="text-muted">--&gt;</span>{" "}
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-black text-udblue">{e.specialization}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">No specialist medical/financial entities detected.</p>
          )}
        </div>
      </section>

      {caseItem.missingFields.length > 0 ? (
        <section className="mt-5 shell-card border-l-4 border-udamber p-5">
          <p className="eyebrow">Phase 1 -- Completeness check</p>
          <h2 className="mt-1 text-xl font-black">Missing fields &amp; auto-drafted follow-up</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {caseItem.missingFields.map((f) => (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-udamber" key={f}>
                {f}
              </span>
            ))}
          </div>
          <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm leading-6">{caseItem.followUpMessage}</p>
        </section>
      ) : null}

      <section className="mt-5 shell-card p-5">
        <p className="eyebrow">Component C -- Filter Node + Optimization Node</p>
        <h2 className="mb-1 mt-1 text-xl font-black">Smart Allocation Matrix -- policy pass/fail</h2>
        <p className="mb-4 text-sm text-muted">{caseItem.match?.rationale}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-wide text-muted">
                <th className="pb-2">Underwriter</th>
                <th className="pb-2">Rank</th>
                <th className="pb-2">Eligible</th>
                <th className="pb-2">Policy checks</th>
              </tr>
            </thead>
            <tbody>
              {caseItem.match?.evaluations
                .slice()
                .sort((a, b) => (a.matchRank || 999) - (b.matchRank || 999))
                .map((evalItem) => {
                  const uw = underwriterRegistry.find((u) => u.id === evalItem.underwriterId);
                  const isChosen = caseItem.assigneeId === evalItem.underwriterId;
                  return (
                    <tr className={`border-t border-line align-top ${isChosen ? "bg-blue-50/50" : ""}`} key={evalItem.underwriterId}>
                      <td className="py-3 font-bold">
                        {uw?.name ?? evalItem.underwriterId}
                        {isChosen ? <span className="ml-2 rounded-full bg-udblue px-2 py-0.5 text-xs font-black text-white">CHOSEN</span> : null}
                      </td>
                      <td className="py-3">{evalItem.matchRank || "--"}</td>
                      <td className="py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-black ${evalItem.eligible ? "bg-green-50 text-udgreen" : "bg-red-50 text-udred"}`}>
                          {evalItem.eligible ? "Eligible" : "Excluded"}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="grid gap-1">
                          {evalItem.policies.map((p) => (
                            <div className="flex items-start gap-2" key={p.policy}>
                              <span className={`mt-0.5 text-xs font-black ${p.passed ? "text-udgreen" : "text-udred"}`}>{p.passed ? "PASS" : "FAIL"}</span>
                              <span className="text-xs text-muted">
                                <strong className="text-ink">{p.policy}:</strong> {p.detail}
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
      </section>

      <section className="mt-5 shell-card p-5">
        <p className="eyebrow">Phase 3 -- Assignment &amp; review</p>
        <h2 className="mb-4 mt-1 text-xl font-black">{isLocked ? "Decision Recorded" : "Actions"}</h2>

        {isLocked ? (
          <p className="text-sm font-bold text-muted">This case is resolved. See the audit log below for the full decision trail.</p>
        ) : caseItem.status === "POOL_QUEUE" ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-udred">
            No qualifying underwriter was found. This case is in the Pool Queue -- go to{" "}
            <Link className="underline" href="/pool-queue">
              Pool Queue
            </Link>{" "}
            for Operations Manager manual override.
          </div>
        ) : (
          <div className="grid items-stretch gap-4 md:grid-cols-3">
            <div className="flex flex-col justify-between rounded-lg border border-line bg-slate-50 p-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-muted">Approve match</p>
                <ul className="mt-3 grid gap-2 text-sm">
                  <li className="rounded-lg border border-line bg-white p-3">Reclassification: confirm complexity band matches file contents.</li>
                  <li className="rounded-lg border border-line bg-white p-3">Review checklist: verify authority limit &amp; specialization match.</li>
                  <li className="rounded-lg border border-line bg-white p-3">Audit log: inspect the full AI decision trace below.</li>
                </ul>
                <p className="mt-3 text-xs text-muted">
                  <strong className="text-ink">Resolve</strong> means: you agree {assignee ? assignee.name : "the assignee"} is the right underwriter for
                  this case and you're closing it out of the active queue. It does not approve/reject the policy checks above -- those are automatic
                  Filter Node facts, not something a human signs off on one by one.
                </p>
              </div>
              <button className="primary-button mt-4 w-full" disabled={busy} onClick={() => void resolveCase()} type="button">
                {caseItem.decisionPath === "STP" ? "Confirm STP assignment & Resolve" : "Approve match & Resolve"}
              </button>
            </div>

            <div className="flex flex-col justify-between rounded-lg border border-line bg-slate-50 p-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-muted">Disagree? Re-route</p>
                <p className="mt-2 text-sm text-muted">AI misjudged complexity or specialty -- ask it to find a different underwriter, excluding the current assignee.</p>
                <textarea
                  className="field-input mt-3 min-h-24"
                  onChange={(e) => setRerouteReason(e.target.value)}
                  placeholder="e.g. Opened the file, found an additional cardiology complication not disclosed at intake."
                  value={rerouteReason}
                />
              </div>
              <button className="ghost-button mt-4 w-full" disabled={busy} onClick={() => void requestReroute()} type="button">
                {busy ? "Re-routing..." : "Request AI Re-routing"}
              </button>
            </div>

            <div className="flex flex-col justify-between rounded-lg border border-red-200 bg-red-50/40 p-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-udred">Reject outright</p>
                <p className="mt-2 text-sm text-muted">No automated candidate is right for this case at all -- skip re-matching and send straight to the Pool Queue for an Ops Manager to hand-pick.</p>
                <textarea
                  className="field-input mt-3 min-h-24"
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. This needs a specific underwriter's sign-off that the matrix doesn't capture."
                  value={rejectReason}
                />
              </div>
              <button className="danger-button mt-4 w-full" disabled={busy} onClick={() => void rejectCase()} type="button">
                {busy ? "Rejecting..." : "Reject & send to Pool Queue"}
              </button>
            </div>
          </div>
        )}

        {error ? <p className="mt-4 text-sm font-bold text-udred">{error}</p> : null}
      </section>

      <section className="mt-5 shell-card p-5">
        <p className="eyebrow">Explainability</p>
        <h2 className="mb-4 mt-1 text-xl font-black">Audit trail for this case</h2>
        <div className="grid gap-2">
          {caseItem.audit
            .slice()
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            .map((event) => (
            <div className="rounded-lg border border-line bg-slate-50 p-3 text-sm" key={event.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">
                  <span
                    className={`mr-2 rounded-full px-2 py-0.5 text-xs font-black ${
                      event.actor === "ai" ? "bg-blue-50 text-udblue" : event.actor === "human" ? "bg-purple-50 text-udpurple" : "bg-slate-200 text-muted"
                    }`}
                  >
                    {event.actor.toUpperCase()}
                  </span>
                  {event.action}
                </p>
                <p className="text-xs text-muted">{new Date(event.createdAt).toLocaleString()}</p>
              </div>
              <p className="mt-1 text-muted">{event.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="shell-card p-4">
      <p className="text-xs font-bold text-muted">{label}</p>
      <strong className="mt-1 block text-lg">{value}</strong>
    </div>
  );
}
