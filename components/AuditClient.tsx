"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CommandBar, CommandButton, FormSection, RecordHeader } from "@/components/ModelDriven";
import { allEvents, getCases } from "@/lib/local-store";
import type { AuditEvent } from "@/lib/types";

export function AuditClient() {
  const [events, setEvents] = useState<AuditEvent[]>([]);

  useEffect(() => {
    setEvents(allEvents(getCases()));
  }, []);

  return (
    <>
      <CommandBar>
        <Link className="command-button" href="/">
          <span aria-hidden className="text-[15px] leading-none">←</span>
          Dashboard
        </Link>
        <CommandButton icon="⟳" onClick={() => setEvents(allEvents(getCases()))}>
          Refresh
        </CommandButton>
      </CommandBar>

      <RecordHeader
        recordType="Governance & explainability"
        title="Audit Log"
        subtitle="Every AI, system, and human action across all cases — Reason Codes, policy checks, re-routing requests, and overrides."
        facts={[{ label: "Events", value: events.length }]}
      />

      <div className="p-4 md:p-6">
        <FormSection title="All events (newest first)">
          <div className="grid gap-1.5">
            {events.map((event) => (
              <div className="rounded border border-line bg-slate-50 p-2.5 text-[13px]" key={event.id}>
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
                  <div className="flex items-center gap-3">
                    <Link className="text-[11px] font-semibold text-udblue hover:underline" href={`/cases/${event.caseId}`}>
                      {event.caseId}
                    </Link>
                    <p className="text-[11px] text-muted">{new Date(event.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                <p className="mt-1 text-muted">{event.detail}</p>
              </div>
            ))}
          </div>
        </FormSection>
      </div>
    </>
  );
}
