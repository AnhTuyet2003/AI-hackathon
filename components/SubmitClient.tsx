"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  CommandBar,
  CommandButton,
  CommandDivider,
  FormGrid,
  FormSection,
  RecordHeader,
} from "@/components/ModelDriven";
import { Spinner } from "@/components/Spinner";
import { getCases, saveCases } from "@/lib/local-store";
import {
  buildReconcileSuggestions,
  medicalHistoryAddition,
  type FieldSuggestion,
} from "@/lib/reconcile";
import { resetDocumentForm } from "@/lib/document-form";
import { createDocumentSession, hashBase64 } from "@/lib/document-session";
import { mentorScenarios } from "@/lib/mentor-cases";
const submitPresets = mentorScenarios
  .slice(0, 3)
  .map((s) => ({ label: `Fill applicant: ${s.id}`, input: s.application }));
import type {
  ApplicationInput,
  DocumentExtraction,
  DocumentSession,
  ReconciliationLog,
  UnderwritingCase,
} from "@/lib/types";

const PRODUCT_LINES = [
  "Individual Life",
  "Group Life",
  "Critical Illness",
  "Health",
];

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "text/plain",
];
const MAX_FILES = 4;
const MAX_FILE_BYTES = 4_000_000;
const FORM_ID = "new-application-form";
const DOCUMENT_BLOCK =
  /\[DOCUMENT_EVIDENCE_START:[^\]]+\][\s\S]*?\[DOCUMENT_EVIDENCE_END:[^\]]+\]/g;

function withoutDocumentEvidence(value: string) {
  return value
    .replace(DOCUMENT_BLOCK, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function documentEvidenceBlock(sessionId: string, evidence: string) {
  return `[DOCUMENT_EVIDENCE_START:${sessionId}] ${evidence} [DOCUMENT_EVIDENCE_END:${sessionId}]`;
}

type PendingFile = {
  name: string;
  mimeType: string;
  dataBase64: string;
  sourceFileHash: string;
  documentSessionId: string;
  createdAt: string;
};
type Decision = {
  choice: "doc" | "mine";
  from: string;
  to: string;
  source: string;
};

const EMPTY: ApplicationInput = {
  applicantName: "",
  age: 30,
  sumAssured: 100_000,
  occupation: "",
  productLine: "Individual Life",
  medicalHistory: "",
  disclosures: "",
  documents: [],
};

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function SubmitClient() {
  const router = useRouter();
  const [form, setForm] = useState<ApplicationInput>(EMPTY);
  const [fileMode, setFileMode] = useState<"replace" | "add">("replace");
  const selectionRequestRef = useRef(0);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [extractions, setExtractions] = useState<DocumentExtraction[]>([]);
  const [documentSession, setDocumentSession] =
    useState<DocumentSession | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [addedMed, setAddedMed] = useState(false);
  const [addedDisc, setAddedDisc] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const extractionRequestRef = useRef(0);

  const suggestions = useMemo(
    () => buildReconcileSuggestions(form, extractions),
    [form, extractions],
  );
  const openFields = suggestions.fieldSuggestions.filter(
    (s) => !decisions[s.key],
  );
  const openConflicts = openFields.filter((s) => s.kind === "conflict");

  function applyPreset(preset: ApplicationInput) {
    selectionRequestRef.current++;
    extractionRequestRef.current++;
    activeSessionRef.current = null;
    setFiles([]);
    setExtractions([]);
    setDocumentSession(null);
    setDecisions({});
    setExtracting(false);
    setAddedMed(false);
    setAddedDisc(false);
    setForm(preset);
  }

  function update<K extends keyof ApplicationInput>(
    key: K,
    value: ApplicationInput[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetDocumentDerivedFormState() {
    setForm((prev) => resetDocumentForm(prev, decisions));
    setExtractions([]);
    setDecisions({});
    setAddedMed(false);
    setAddedDisc(false);
  }

  async function runExtraction(
    list: PendingFile[],
    session: DocumentSession | null,
  ) {
    const requestId = ++extractionRequestRef.current;
    setExtractions([]);
    if (!list.length) {
      setExtracting(false);
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      const response = await fetch("/api/documents/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: list,
          documentSessionId: session?.documentSessionId,
        }),
      });
      const payload = (await response.json()) as {
        extractions?: DocumentExtraction[];
        error?: string;
      };
      if (!response.ok || !payload.extractions)
        throw new Error(payload.error || "Extraction failed.");
      if (
        requestId !== extractionRequestRef.current ||
        activeSessionRef.current !== session?.documentSessionId
      )
        return;
      setExtractions(payload.extractions);
    } catch (err) {
      if (requestId === extractionRequestRef.current) setExtractions([]);
      if (requestId === extractionRequestRef.current)
        setError(
          err instanceof Error ? err.message : "Could not read the documents.",
        );
    } finally {
      if (requestId === extractionRequestRef.current) setExtracting(false);
    }
  }

  async function onFilesPicked(event: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";

    for (const file of picked) {
      if (!ACCEPTED_TYPES.includes(file.type))
        return setError(`"${file.name}" is not a PDF, DOCX, JPG, PNG, or TXT.`);
      if (file.size > MAX_FILE_BYTES)
        return setError(`"${file.name}" is larger than 4 MB.`);
    }

    if (!picked.length) return;
    const selectionId = ++selectionRequestRef.current;
    extractionRequestRef.current++;
    activeSessionRef.current = null;
    setExtracting(true);
    setExtractions([]);
    try {
      const encoded = await Promise.all(
        picked.map(async (file) => {
          const dataBase64 = await readAsBase64(file);
          return {
            name: file.name,
            mimeType: file.type,
            dataBase64,
            sourceFileHash: await hashBase64(dataBase64),
          };
        }),
      );
      if (selectionId !== selectionRequestRef.current) return;
      const merged = fileMode === "add" ? [...files] : [];
      for (const f of encoded) {
        const existingIndex = merged.findIndex((m) => m.name === f.name);
        if (existingIndex >= 0)
          merged[existingIndex] = {
            ...f,
            documentSessionId: "",
            createdAt: "",
          };
        else merged.push({ ...f, documentSessionId: "", createdAt: "" });
      }
      const capped = merged.slice(0, MAX_FILES);
      if (merged.length > MAX_FILES)
        setError(`Only the first ${MAX_FILES} documents are kept.`);
      const session = createDocumentSession(
        capped.map((f) => f.name).join(", "),
        capped[0]?.sourceFileHash,
      );
      const sessionFiles = capped.map((file) => ({
        ...file,
        documentSessionId: session.documentSessionId,
        createdAt: session.createdAt,
      }));
      setDocumentSession(session);
      activeSessionRef.current = session.documentSessionId;
      resetDocumentDerivedFormState();
      setFiles(sessionFiles);
      void runExtraction(sessionFiles, session);
    } catch (err) {
      if (selectionId === selectionRequestRef.current) {
        setExtracting(false);
        setError(
          err instanceof Error
            ? err.message
            : "Could not read the selected files.",
        );
      }
    }
  }

  function removeFile(name: string) {
    selectionRequestRef.current++;
    const next = files.filter((f) => f.name !== name);
    const session = next.length
      ? createDocumentSession(
          next.map((f) => f.name).join(", "),
          next[0]?.sourceFileHash,
        )
      : null;
    const sessionFiles = session
      ? next.map((file) => ({
          ...file,
          documentSessionId: session.documentSessionId,
          createdAt: session.createdAt,
        }))
      : [];
    setDocumentSession(session);
    activeSessionRef.current = session?.documentSessionId ?? null;
    resetDocumentDerivedFormState();
    setFiles(sessionFiles);
    void runExtraction(sessionFiles, session);
  }

  function useDocValue(s: FieldSuggestion) {
    if (s.key === "age" || s.key === "sumAssured")
      update(s.key, Number(s.docValue));
    else update(s.key, s.docValue);
    setDecisions((d) => ({
      ...d,
      [s.key]: {
        choice: "doc",
        from: s.formValue || "(empty)",
        to: s.docValue,
        source: s.source,
      },
    }));
  }

  function keepMine(s: FieldSuggestion) {
    setDecisions((d) => ({
      ...d,
      [s.key]: {
        choice: "mine",
        from: s.formValue,
        to: s.docValue,
        source: s.source,
      },
    }));
  }

  function undoDecision(key: string) {
    setDecisions((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  }

  function addFindingsToMedicalHistory() {
    const addition = medicalHistoryAddition(suggestions.findings);
    if (!addition) return;
    const sessionId = documentSession?.documentSessionId ?? "current";
    update(
      "medicalHistory",
      [
        withoutDocumentEvidence(form.medicalHistory),
        documentEvidenceBlock(sessionId, addition),
      ]
        .filter(Boolean)
        .join(" ")
        .trim(),
    );
    setAddedMed(true);
  }

  function addFindingsToDisclosures() {
    if (!suggestions.disclosuresText) return;
    const sessionId = documentSession?.documentSessionId ?? "current";
    update(
      "disclosures",
      [
        withoutDocumentEvidence(form.disclosures),
        documentEvidenceBlock(sessionId, suggestions.disclosuresText),
      ]
        .filter(Boolean)
        .join(" ")
        .trim(),
    );
    setAddedDisc(true);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const documents = files.length ? files.map((f) => f.name) : form.documents;

    if (
      files.length &&
      (!documentSession ||
        extractions.length !== files.length ||
        extractions.some(
          (e) => e.documentSessionId !== documentSession.documentSessionId,
        ))
    ) {
      setError(
        "The selected document changed while it was being read. Please wait for extraction to finish and try again.",
      );
      setSubmitting(false);
      return;
    }

    const applied = Object.entries(decisions)
      .filter(([, d]) => d.choice === "doc")
      .map(([field, d]) => ({
        field,
        from: d.from,
        to: d.to,
        source: d.source,
      }));
    const keptOwn = [
      ...Object.entries(decisions)
        .filter(([, d]) => d.choice === "mine")
        .map(([field, d]) => ({
          field,
          userValue: d.from,
          documentValue: d.to,
          source: d.source,
        })),
      // Conflicts the submitter never resolved -- recorded as implicitly keeping their own value.
      ...openConflicts.map((s) => ({
        field: s.key,
        userValue: s.formValue,
        documentValue: s.docValue,
        source: s.source,
      })),
    ];
    const reconciliation: ReconciliationLog = {
      applied,
      keptOwn,
      addedToMedicalHistory: addedMed,
      addedToDisclosures: addedDisc,
    };

    try {
      const response = await fetch("/api/cases/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          documents,
          files,
          extractions,
          reconciliation,
          documentSessionId: documentSession?.documentSessionId,
        }),
      });
      const payload = (await response.json()) as {
        case?: UnderwritingCase;
        error?: string;
      };
      if (!response.ok || !payload.case)
        throw new Error(payload.error || "Failed to process application.");

      const cases = getCases();
      saveCases([payload.case, ...cases]);
      router.push(`/cases/${payload.case.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <CommandBar>
        <CommandButton
          form={FORM_ID}
          icon="✓"
          primary
          type="submit"
          disabled={submitting || extracting}
        >
          {submitting
            ? "Running AI pipeline…"
            : extracting
              ? "Reading documents…"
              : "Submit Application"}
        </CommandButton>
        <CommandDivider />
        <span className="px-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Applicant presets · attach a document next
        </span>
        {submitPresets.map(({ label, input }) => (
          <CommandButton
            key={label}
            disabled={submitting}
            onClick={() => applyPreset(input)}
            icon="＋"
          >
            {label}
          </CommandButton>
        ))}
      </CommandBar>

      <RecordHeader
        recordType="Phase 1 — Submission"
        title="New Business Application"
        status="Draft"
        subtitle="Attaching a document extracts its text immediately; images need OCR. Review any differences, decide which value is right, then submit — the pipeline scores the case on the reconciled data."
      />

      <div className="p-4 md:p-6">
        {/* The command-bar Submit button targets this form via the form attribute. */}
        <form className="space-y-4" id={FORM_ID} onSubmit={onSubmit}>
          <button type="submit" hidden />

          <FormSection title="Applicant & Policy">
            <FormGrid cols={2}>
              <label className="field-label">
                Applicant name
                <input
                  className="field-input"
                  onChange={(e) => update("applicantName", e.target.value)}
                  required
                  value={form.applicantName}
                />
              </label>
              <label className="field-label">
                Occupation
                <input
                  className="field-input"
                  onChange={(e) => update("occupation", e.target.value)}
                  required
                  value={form.occupation}
                />
              </label>
              <label className="field-label">
                Age
                <input
                  className="field-input"
                  min={0}
                  onChange={(e) => update("age", Number(e.target.value))}
                  required
                  type="number"
                  value={form.age}
                />
              </label>
              <label className="field-label">
                Sum Assured (USD)
                <input
                  className="field-input"
                  min={0}
                  onChange={(e) => update("sumAssured", Number(e.target.value))}
                  required
                  type="number"
                  value={form.sumAssured}
                />
              </label>
              <label className="field-label">
                Product line
                <select
                  className="field-input"
                  onChange={(e) => update("productLine", e.target.value)}
                  value={form.productLine}
                >
                  {PRODUCT_LINES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Upload action
                <select
                  className="field-input"
                  value={fileMode}
                  onChange={(e) =>
                    setFileMode(e.target.value as "replace" | "add")
                  }
                >
                  <option value="replace">Replace current documents</option>
                  <option value="add">
                    Add supporting documents to this case
                  </option>
                </select>
              </label>
              <label className="field-label">
                Supporting documents (PDF / DOCX / JPG / PNG / TXT, max{" "}
                {MAX_FILES})
                <input
                  accept=".pdf,.docx,.png,.jpg,.jpeg,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,text/plain"
                  className="field-input"
                  disabled={submitting}
                  multiple
                  onChange={onFilesPicked}
                  type="file"
                />
              </label>
            </FormGrid>

            {files.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {files.map((f) => (
                  <span
                    className="inline-flex items-center gap-2 rounded bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-ink"
                    key={f.name}
                  >
                    {f.name}
                    <button
                      aria-label={`Remove ${f.name}`}
                      className="text-muted hover:text-udred"
                      disabled={submitting}
                      onClick={() => removeFile(f.name)}
                      type="button"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {extracting ? (
                  <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-muted">
                    <Spinner className="h-3.5 w-3.5" /> Reading documents…
                  </span>
                ) : null}
              </div>
            ) : null}
          </FormSection>

          {extractions.length > 0 && !extracting ? (
            <ReconcilePanel
              addedDisc={addedDisc}
              addedMed={addedMed}
              decisions={decisions}
              disclosuresText={suggestions.disclosuresText}
              extractions={extractions}
              findings={suggestions.findings}
              onAddToDisclosures={addFindingsToDisclosures}
              onAddToMedicalHistory={addFindingsToMedicalHistory}
              onKeepMine={keepMine}
              onUndo={undoDecision}
              onUseDoc={useDocValue}
              openFields={openFields}
            />
          ) : null}

          <FormSection title="Unstructured Data">
            <label className="field-label">
              Medical history / doctor notes
              <textarea
                className="field-input min-h-24"
                onChange={(e) => update("medicalHistory", e.target.value)}
                value={form.medicalHistory}
              />
            </label>
            <label className="field-label mt-3">
              Financial / other disclosures
              <textarea
                className="field-input min-h-20"
                onChange={(e) => update("disclosures", e.target.value)}
                value={form.disclosures}
              />
            </label>
          </FormSection>

          {openConflicts.length > 0 ? (
            <p className="rounded border-l-2 border-udamber bg-amber-50 p-2.5 text-[13px] font-semibold text-udamber">
              {openConflicts.length} field(s) still differ from the documents.
              Align them above, or submit with your values — the mismatch is
              recorded in the audit trail either way.
            </p>
          ) : null}

          {error ? (
            <p className="text-[13px] font-semibold text-udred">{error}</p>
          ) : null}

          <button
            className="primary-button inline-flex items-center gap-2"
            disabled={submitting || extracting}
            type="submit"
          >
            {submitting ? <Spinner /> : null}
            {submitting
              ? "Running AI pipeline…"
              : extracting
                ? "Reading documents…"
                : "Submit Application"}
          </button>
        </form>

        <div className="mt-8 border-t border-line pt-6">
          <FormSection title="Demo Documents">
            <p className="text-[13px] text-muted mb-3">
              Download these sample PDFs to test the extraction and intake
              pipeline.
            </p>
            <div className="flex flex-wrap gap-2">
              {mentorScenarios.map((s) => (
                <a
                  key={s.id}
                  className="ghost-button inline-block"
                  download
                  href={`/mentor-documents/${s.id}.pdf`}
                >
                  Download {s.id}.pdf
                </a>
              ))}
            </div>
          </FormSection>
        </div>
      </div>
    </>
  );
}

function ReconcilePanel({
  extractions,
  openFields,
  decisions,
  findings,
  disclosuresText,
  addedMed,
  addedDisc,
  onUseDoc,
  onKeepMine,
  onUndo,
  onAddToMedicalHistory,
  onAddToDisclosures,
}: {
  extractions: DocumentExtraction[];
  openFields: FieldSuggestion[];
  decisions: Record<string, Decision>;
  findings: string[];
  disclosuresText: string;
  addedMed: boolean;
  addedDisc: boolean;
  onUseDoc: (s: FieldSuggestion) => void;
  onKeepMine: (s: FieldSuggestion) => void;
  onUndo: (key: string) => void;
  onAddToMedicalHistory: () => void;
  onAddToDisclosures: () => void;
}) {
  const decidedEntries = Object.entries(decisions);

  return (
    <FormSection
      title="Data Ingestion Engine — reconcile"
      className="border-l-2 border-l-udblue"
    >
      <p className="text-[13px] text-muted">
        Documents read. Confirm the details before submitting.
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        {extractions.map((e) => (
          <span
            className="inline-flex items-center gap-2 rounded bg-slate-100 px-2.5 py-1 text-[11px] font-semibold"
            key={e.fileName}
          >
            {e.fileName}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                e.provider === "gemini"
                  ? "bg-blue-50 text-udblue"
                  : "bg-amber-50 text-udamber"
              }`}
            >
              {e.provider === "gemini" ? "Gemini" : "Local text extraction"}
            </span>
            <span className="text-muted">{e.source ?? "unknown source"}</span>
            {e.documentSessionId ? (
              <span className="text-muted">
                session {e.documentSessionId.slice(-8)}
              </span>
            ) : null}
          </span>
        ))}
      </div>

      {extractions.map((e) => (
        <details
          key={e.documentSessionId + e.fileName}
          className="mt-3 rounded border border-line p-3"
        >
          <summary className="cursor-pointer font-semibold">
            Read extracted evidence: {e.fileName}
          </summary>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-[13px]">
            {e.rawText ||
              "No readable text. Supply a readable document or OCR."}
          </pre>
          <p className="mt-2">
            Diagnosis: {e.fields.diagnosis || "Not supplied"}
          </p>
          <p>
            Provider:{" "}
            {e.fields.facilityName || e.fields.department || "Not supplied"}
          </p>
          {e.warnings.map((w, i) => (
            <p key={i} className="text-udamber">
              {w}
            </p>
          ))}
        </details>
      ))}

      {openFields.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {openFields.map((s) => (
            <div
              className="grid gap-2 rounded border border-line bg-slate-50 p-2.5 text-[13px] md:grid-cols-[1fr_auto] md:items-center"
              key={s.key}
            >
              <div>
                <span className="font-semibold">{s.label}</span>{" "}
                {s.kind === "conflict" ? (
                  <span className="text-muted">
                    you:{" "}
                    <span className="font-medium text-ink">{s.formValue}</span>{" "}
                    · document:{" "}
                    <span className="font-medium text-ink">{s.docValue}</span>
                  </span>
                ) : (
                  <span className="text-muted">
                    not entered · document:{" "}
                    <span className="font-medium text-ink">{s.docValue}</span>
                  </span>
                )}
                <span className="ml-1 text-[11px] text-muted">
                  ({s.source})
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  className="primary-button px-2.5 py-1 text-[12px]"
                  onClick={() => onUseDoc(s)}
                  type="button"
                >
                  {s.kind === "conflict" ? `Use ${s.docValue}` : "Use document"}
                </button>
                <button
                  className="ghost-button px-2.5 py-1 text-[12px]"
                  onClick={() => onKeepMine(s)}
                  type="button"
                >
                  {s.kind === "conflict" ? "Keep mine" : "Ignore"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {decidedEntries.length > 0 ? (
        <div className="mt-2 grid gap-1 text-[11px] text-muted">
          {decidedEntries.map(([key, d]) => (
            <div className="flex flex-wrap items-center gap-2" key={key}>
              <span>
                <strong className="text-ink">{key}</strong>:{" "}
                {d.choice === "doc"
                  ? `using document value "${d.to}"`
                  : `keeping your value "${d.from}"`}
              </span>
              <button
                className="underline hover:text-ink"
                onClick={() => onUndo(key)}
                type="button"
              >
                undo
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {findings.length > 0 ? (
        <div className="mt-3 rounded border border-line bg-slate-50 p-2.5 text-[13px]">
          <p className="font-semibold">Medical findings in the documents</p>
          <p className="mt-1 text-muted">{findings.join("; ")}.</p>
          <button
            className="ghost-button mt-2 px-2.5 py-1 text-[12px]"
            disabled={addedMed}
            onClick={onAddToMedicalHistory}
            type="button"
          >
            {addedMed ? "Added to medical history" : "Add to medical history"}
          </button>
        </div>
      ) : null}

      {disclosuresText ? (
        <div className="mt-2 rounded border border-line bg-slate-50 p-2.5 text-[13px]">
          <p className="font-semibold">Financial note in the documents</p>
          <p className="mt-1 text-muted">{disclosuresText}</p>
          <button
            className="ghost-button mt-2 px-2.5 py-1 text-[12px]"
            disabled={addedDisc}
            onClick={onAddToDisclosures}
            type="button"
          >
            {addedDisc ? "Added to disclosures" : "Add to disclosures"}
          </button>
        </div>
      ) : null}
    </FormSection>
  );
}
