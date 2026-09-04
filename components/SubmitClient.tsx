"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getCases, saveCases } from "@/lib/local-store";
import type { ApplicationInput, UnderwritingCase } from "@/lib/types";

const PRODUCT_LINES = ["Individual Life", "Group Life", "Critical Illness", "Health"];

const PRESETS: Record<string, ApplicationInput> = {
  "Clean / STP": {
    applicantName: "Pham Thi Lan",
    age: 27,
    sumAssured: 60_000,
    occupation: "Marketing Specialist",
    productLine: "Individual Life",
    medicalHistory: "No significant medical history. Non-smoker.",
    disclosures: "No prior claims.",
    documents: ["application-form.pdf", "id-verification.pdf"]
  },
  "Specialist match": {
    applicantName: "Do Minh Chau",
    age: 49,
    sumAssured: 420_000,
    occupation: "Bank Manager",
    productLine: "Individual Life",
    medicalHistory: "History of Type 2 Diabetes, managed with medication for 5 years.",
    disclosures: "Applicant discloses ongoing endocrinology follow-up.",
    documents: ["application-form.pdf", "medical-questionnaire.pdf"]
  },
  "High complexity / escalation": {
    applicantName: "Vu Quang Huy",
    age: 58,
    sumAssured: 2_200_000,
    occupation: "Offshore Drilling Engineer",
    productLine: "Individual Life",
    medicalHistory: "Complex multi-morbidity: cardiac history with Myocardial Infarction, liver condition, recurring complications noted.",
    disclosures: "High-net-worth applicant, requests expedited HNW financial profiling.",
    documents: ["application-form.pdf", "medical-questionnaire.pdf", "financial-statement.pdf"]
  }
};

const EMPTY: ApplicationInput = {
  applicantName: "",
  age: 30,
  sumAssured: 100_000,
  occupation: "",
  productLine: "Individual Life",
  medicalHistory: "",
  disclosures: "",
  documents: []
};

export function SubmitClient() {
  const router = useRouter();
  const [form, setForm] = useState<ApplicationInput>(EMPTY);
  const [documentsText, setDocumentsText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(preset: ApplicationInput) {
    setForm(preset);
    setDocumentsText(preset.documents.join(", "));
  }

  function update<K extends keyof ApplicationInput>(key: K, value: ApplicationInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const documents = documentsText
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    try {
      const response = await fetch("/api/cases/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, documents })
      });
      const payload = (await response.json()) as { case?: UnderwritingCase; error?: string };
      if (!response.ok || !payload.case) throw new Error(payload.error || "Failed to process application.");

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
    <div>
      <header>
        <p className="eyebrow">Phase 1 -- Submission</p>
        <h1 className="mt-1 text-3xl font-black">Submit New Business Application</h1>
        <p className="mt-2 text-sm text-muted">On submit, status is set to PENDING and the AI pipeline (Classifier + NER + Filter + Optimization) runs immediately.</p>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        {Object.entries(PRESETS).map(([label, preset]) => (
          <button className="ghost-button" key={label} onClick={() => applyPreset(preset)} type="button">
            Fill demo case: {label}
          </button>
        ))}
      </div>

      <form className="mt-6 grid gap-5 shell-card p-6" onSubmit={onSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="field-label">
            Applicant name
            <input className="field-input" onChange={(e) => update("applicantName", e.target.value)} required value={form.applicantName} />
          </label>
          <label className="field-label">
            Occupation
            <input className="field-input" onChange={(e) => update("occupation", e.target.value)} required value={form.occupation} />
          </label>
          <label className="field-label">
            Age
            <input className="field-input" min={0} onChange={(e) => update("age", Number(e.target.value))} required type="number" value={form.age} />
          </label>
          <label className="field-label">
            Sum Assured (USD)
            <input className="field-input" min={0} onChange={(e) => update("sumAssured", Number(e.target.value))} required type="number" value={form.sumAssured} />
          </label>
          <label className="field-label">
            Product line
            <select className="field-input" onChange={(e) => update("productLine", e.target.value)} value={form.productLine}>
              {PRODUCT_LINES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Documents (comma-separated file names)
            <input className="field-input" onChange={(e) => setDocumentsText(e.target.value)} value={documentsText} />
          </label>
        </div>

        <label className="field-label">
          Medical history / doctor notes
          <textarea className="field-input min-h-24" onChange={(e) => update("medicalHistory", e.target.value)} value={form.medicalHistory} />
        </label>

        <label className="field-label">
          Financial / other disclosures
          <textarea className="field-input min-h-20" onChange={(e) => update("disclosures", e.target.value)} value={form.disclosures} />
        </label>

        {error ? <p className="text-sm font-bold text-udred">{error}</p> : null}

        <button className="primary-button justify-self-start" disabled={submitting} type="submit">
          {submitting ? "Running AI pipeline..." : "Submit Application"}
        </button>
      </form>
    </div>
  );
}
