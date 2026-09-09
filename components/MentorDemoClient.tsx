"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { mentorScenarios } from "@/lib/mentor-cases";
import { createDocumentSession, hashBase64 } from "@/lib/document-session";
import { getCases, saveCases } from "@/lib/local-store";
import { RecordHeader, FormSection } from "./ModelDriven";

export function MentorDemoClient() {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function run(id: string) {
    setBusy(id);
    setError("");
    try {
      const s = mentorScenarios.find((s) => s.id === id)!;
      const dataBase64 = btoa(unescape(encodeURIComponent(s.text)));
      const sourceFileHash = await hashBase64(dataBase64);
      const session = createDocumentSession(`${id}.txt`, sourceFileHash);
      const file = {
        name: `${id}.txt`,
        mimeType: "text/plain",
        dataBase64,
        sourceFileHash,
        documentSessionId: session.documentSessionId,
      };
      const extraction = await fetch("/api/documents/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: [file] }),
      });
      if (!extraction.ok) throw new Error("Document extraction failed.");
      const response = await fetch("/api/cases/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...s.application,
          documents: [file.name],
          files: [file],
          documentSessionId: session.documentSessionId,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      saveCases([result.case, ...getCases()]);
      router.push(`/cases/${result.case.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <RecordHeader
        recordType="Mentor walkthrough"
        title="Integrated flow demo"
        subtitle="Synthetic documents processed through the real extraction and intake APIs. Local deterministic processing is the default."
      />
      <div className="space-y-4 p-6">
        <p>
          Run a case below, or download its document and upload it through
          Submit Application to demonstrate reconciliation and file replacement.
          Use applicant name “Mentor Example”. Scores describe review
          complexity, not approval of coverage.
        </p>
        {error && (
          <p role="alert" className="text-udred">
            {error}
          </p>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {mentorScenarios.map((s) => (
            <FormSection key={s.id} title={s.title}>
              <p className="mb-3">
                Expected workflow: {s.expected.replaceAll("_", " ")}
              </p>
              <button
                className="primary-button mr-2"
                disabled={!!busy}
                onClick={() => void run(s.id)}
              >
                {busy === s.id ? "Processing…" : "Run case"}
              </button>
              <a
                className="ghost-button inline-block"
                download
                href={`/mentor-documents/${s.id}.txt`}
              >
                Download document
              </a>
            </FormSection>
          ))}
        </div>
        <p className="text-muted">
          The initial dashboard contains previews calculated by the same rules.
          Run a case here to create a server-verified case with working review
          actions. Queue load is a fixed demo roster, not a live workforce
          system.
        </p>
      </div>
    </>
  );
}
