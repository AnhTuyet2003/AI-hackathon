"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { allEvents, getCases } from "@/lib/local-store";
import type { AuditEvent } from "@/lib/types";

export function AuditClient() {
  const [events, setEvents] = useState<AuditEvent[]>([]);

  useEffect(() => {
    setEvents(allEvents(getCases()));
  }, []);

  return (
    <div>
      <header>
        <p className="eyebrow">Governance &amp; explainability</p>
        <h1 className="mt-1 text-3xl font-black">Audit Log</h1>
        <p className="mt-2 text-sm text-muted">Every AI, system, and human action across all cases -- Reason Codes, policy checks, re-routing requests, and overrides.</p>
      </header>

      <section className="mt-6 grid gap-2">
        {events.map((event) => (
          <div className="shell-card p-4 text-sm" key={event.id}>
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
              <div className="flex items-center gap-3">
                <Link className="text-xs font-bold text-udblue hover:underline" href={`/cases/${event.caseId}`}>
                  {event.caseId}
                </Link>
                <p className="text-xs text-muted">{new Date(event.createdAt).toLocaleString()}</p>
              </div>
            </div>
            <p className="mt-1 text-muted">{event.detail}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
