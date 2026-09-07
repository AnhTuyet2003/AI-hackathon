import type {
  ApplicationInput,
  DocumentExtraction,
  DocumentKind,
  ExtractedFields,
  FieldOverride,
  IngestionResult,
  ReconciliationLog
} from "./types";

// Pure helpers shared by the server (lib/document-ingest.ts, the API routes) and the client
// (components/SubmitClient.tsx). No @google/genai import here, so it is safe for the browser
// bundle. Two jobs:
//   1. Turn a set of DocumentExtraction results into suggestions the submitter reconciles by hand
//      (the interactive flow), or into a straight auto-merge (the legacy / direct-API flow).
//   2. Sanitise client-supplied extraction + reconciliation payloads before they reach the pipeline.

// ------------------------------------------------------------------------------------------------
// Combine several documents' fields into one view. Last concrete scalar wins (upload order);
// arrays union.
// ------------------------------------------------------------------------------------------------
export function combineExtractedFields(all: ExtractedFields[]): ExtractedFields {
  const out: ExtractedFields = {};
  for (const f of all) {
    for (const [key, value] of Object.entries(f) as [keyof ExtractedFields, unknown][]) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        if (!value.length) continue;
        const prev = (out[key] as string[] | undefined) ?? [];
        (out[key] as string[]) = Array.from(new Set([...prev, ...value.map(String)]));
      } else {
        (out[key] as unknown) = value;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Interactive reconciliation: what the submitter is asked to confirm.
// ------------------------------------------------------------------------------------------------
export type FieldSuggestion = {
  key: "age" | "sumAssured" | "occupation" | "productLine";
  label: string;
  kind: "fill" | "conflict";
  formValue: string; // "" when the form field is empty
  docValue: string;
  source: string;
};

export type ReconcileSuggestions = {
  fieldSuggestions: FieldSuggestion[];
  findings: string[]; // human-readable medical findings not mapped to a form field
  disclosuresText: string;
};

const SCALAR_FIELDS = [
  { key: "age", label: "Age", numeric: true },
  { key: "sumAssured", label: "Sum Assured", numeric: true },
  { key: "occupation", label: "Occupation", numeric: false },
  { key: "productLine", label: "Product line", numeric: false }
] as const;

export function buildReconcileSuggestions(form: ApplicationInput, extractions: DocumentExtraction[]): ReconcileSuggestions {
  const combined = combineExtractedFields(extractions.map((e) => e.fields));
  const sourceFor = (predicate: (f: ExtractedFields) => boolean) =>
    extractions.find((e) => predicate(e.fields))?.fileName ?? "documents";

  const fieldSuggestions: FieldSuggestion[] = [];
  for (const f of SCALAR_FIELDS) {
    const docRaw = combined[f.key];
    if (docRaw == null || (typeof docRaw === "string" && !docRaw.trim())) continue;
    const docValue = String(docRaw);
    const formRaw = form[f.key];
    const formEmpty = f.numeric ? Number(formRaw) === 0 : !String(formRaw).trim();
    const same = f.numeric
      ? Number(formRaw) === Number(docRaw)
      : String(formRaw).trim().toLowerCase() === docValue.trim().toLowerCase();
    if (same) continue;
    fieldSuggestions.push({
      key: f.key,
      label: f.label,
      kind: formEmpty ? "fill" : "conflict",
      formValue: formEmpty ? "" : String(formRaw),
      docValue,
      source: sourceFor((x) => String(x[f.key] ?? "") === docValue)
    });
  }

  const findings: string[] = [];
  if (combined.medicalConditions?.length) findings.push(`Conditions: ${combined.medicalConditions.join(", ")}`);
  if (combined.medications?.length) findings.push(`Medications: ${combined.medications.join(", ")}`);
  if (combined.smoker === true) findings.push(`Smoker${combined.packsPerWeek ? ` (~${combined.packsPerWeek} packs/week)` : ""}`);
  if (combined.smoker === false) findings.push("Non-smoker");
  if (combined.bmi) findings.push(`BMI ${combined.bmi}`);
  if (combined.dangerousSports?.length) findings.push(`Dangerous sports: ${combined.dangerousSports.join(", ")}`);
  if (combined.medicalSummary) findings.push(combined.medicalSummary);

  return { fieldSuggestions, findings, disclosuresText: combined.disclosuresText?.trim() ?? "" };
}

export function medicalHistoryAddition(findings: string[]): string {
  return findings.length ? `From documents: ${findings.join("; ")}.` : "";
}

// ------------------------------------------------------------------------------------------------
// Legacy auto-merge: document values win, every change recorded. Used by the direct-API path and
// the offline seed. The interactive UI does not call this -- the submitter reconciles instead.
// ------------------------------------------------------------------------------------------------
export function autoMergeExtractions(
  input: ApplicationInput,
  extractions: DocumentExtraction[]
): { input: ApplicationInput; ingestion: IngestionResult } {
  const combined = combineExtractedFields(extractions.map((e) => e.fields));
  const next: ApplicationInput = { ...input };
  const filledFields: string[] = [];
  const overriddenFields: FieldOverride[] = [];
  const sourceFor = (predicate: (f: ExtractedFields) => boolean) =>
    extractions.find((e) => predicate(e.fields))?.fileName ?? "documents";

  applyNumber("age", combined.age, input.age === 0);
  applyNumber("sumAssured", combined.sumAssured, input.sumAssured === 0);
  applyString("occupation", combined.occupation, !input.occupation.trim());
  applyString("productLine", combined.productLine, false);

  function applyNumber(field: "age" | "sumAssured", docValue: number | undefined, userEmpty: boolean) {
    if (docValue == null || !Number.isFinite(docValue)) return;
    if (userEmpty) {
      next[field] = docValue;
      filledFields.push(field);
    } else if (input[field] !== docValue) {
      overriddenFields.push({ field, from: String(input[field]), to: String(docValue), source: sourceFor((f) => f[field] === docValue) });
      next[field] = docValue;
    }
  }

  function applyString(field: "occupation" | "productLine", docValue: string | undefined, userEmpty: boolean) {
    const value = docValue?.trim();
    if (!value) return;
    if (userEmpty) {
      next[field] = value;
      filledFields.push(field);
    } else if (input[field].trim().toLowerCase() !== value.toLowerCase()) {
      overriddenFields.push({ field, from: input[field], to: value, source: sourceFor((f) => f[field]?.trim() === value) });
      next[field] = value;
    }
  }

  const medBits: string[] = [];
  if (combined.medicalConditions?.length) medBits.push(`Conditions (from documents): ${combined.medicalConditions.join(", ")}.`);
  if (combined.medications?.length) medBits.push(`Medications (from documents): ${combined.medications.join(", ")}.`);
  if (combined.smoker === true) medBits.push(`Smoker${combined.packsPerWeek ? ` (~${combined.packsPerWeek} packs/week)` : ""} per submitted documents.`);
  if (combined.dangerousSports?.length) medBits.push(`Dangerous sports (from documents): ${combined.dangerousSports.join(", ")}.`);
  if (combined.bmi && combined.bmi >= 35) medBits.push(`Document BMI ${combined.bmi} (obese range).`);
  if (combined.medicalSummary) medBits.push(combined.medicalSummary);

  let appendedToMedicalHistory = false;
  if (medBits.length) {
    next.medicalHistory = [input.medicalHistory.trim(), ...medBits].filter(Boolean).join(" ").trim();
    appendedToMedicalHistory = true;
  }
  if (combined.disclosuresText?.trim()) {
    next.disclosures = [input.disclosures.trim(), combined.disclosuresText.trim()].filter(Boolean).join(" ").trim();
  }

  const docNames = extractions.map((e) => e.fileName);
  if (docNames.length) next.documents = Array.from(new Set([...input.documents, ...docNames]));

  return {
    input: next,
    ingestion: { extractions, filledFields, overriddenFields, appendedToMedicalHistory, mode: "auto", reconciliation: null }
  };
}

// ------------------------------------------------------------------------------------------------
// Shared normalisers (also used by lib/document-ingest.ts for the raw Gemini JSON).
// ------------------------------------------------------------------------------------------------
export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).slice(0, 20);
}

export function normalizeKind(value: unknown): DocumentKind | null {
  return value === "medical" || value === "financial" || value === "identity" || value === "application" || value === "other"
    ? value
    : null;
}

export function kindFromName(name: string): DocumentKind {
  if (/doctor|medical|health|questionnaire|clinical|ehr/i.test(name)) return "medical";
  if (/financial|statement|income|salary|hnw/i.test(name)) return "financial";
  if (/id-|identity|passport|kyc/i.test(name)) return "identity";
  if (/application|form|proposal/i.test(name)) return "application";
  return "other";
}

export function summarizeExtraction(fields: ExtractedFields, fileName: string): string {
  const parts: string[] = [];
  if (fields.age) parts.push(`age ${fields.age}`);
  if (fields.occupation) parts.push(fields.occupation);
  if (fields.smoker === true) parts.push("smoker");
  if (fields.smoker === false) parts.push("non-smoker");
  if (fields.medicalConditions?.length) parts.push(fields.medicalConditions.join(", "));
  if (fields.medications?.length) parts.push(`${fields.medications.length} medication(s)`);
  if (fields.annualIncome) parts.push(`income ${fields.annualIncome.toLocaleString("en-US")}`);
  if (fields.sumAssured) parts.push(`sum assured ${fields.sumAssured.toLocaleString("en-US")}`);
  return parts.length ? `${fileName}: ${parts.join(" | ")}.` : `${fileName}: no fields extracted.`;
}

// ------------------------------------------------------------------------------------------------
// Sanitise client-supplied payloads for the /api/cases/process route.
// ------------------------------------------------------------------------------------------------
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function sanitizeFields(value: unknown): ExtractedFields {
  if (!isRecord(value)) return {};
  const f: ExtractedFields = {};
  f.age = num(value.age);
  f.sumAssured = num(value.sumAssured);
  f.occupation = str(value.occupation, 120) || undefined;
  f.productLine = str(value.productLine, 60) || undefined;
  if (value.smoker === true || value.smoker === false) f.smoker = value.smoker;
  f.packsPerWeek = num(value.packsPerWeek);
  f.heightCm = num(value.heightCm);
  f.weightKg = num(value.weightKg);
  f.bmi = num(value.bmi);
  f.annualIncome = num(value.annualIncome);
  f.maritalStatus = str(value.maritalStatus, 40) || undefined;
  const mc = normalizeStringArray(value.medicalConditions);
  const md = normalizeStringArray(value.medications);
  const ds = normalizeStringArray(value.dangerousSports);
  if (mc.length) f.medicalConditions = mc;
  if (md.length) f.medications = md;
  if (ds.length) f.dangerousSports = ds;
  f.disclosuresText = str(value.disclosuresText, 600) || undefined;
  f.medicalSummary = str(value.medicalSummary, 600) || undefined;
  return f;
}

export function parseExtractions(value: unknown): DocumentExtraction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((item): DocumentExtraction[] => {
    if (!isRecord(item)) return [];
    const fileName = str(item.fileName, 180);
    if (!fileName) return [];
    return [
      {
        fileName,
        mimeType: str(item.mimeType, 100),
        kind: normalizeKind(item.kind) ?? kindFromName(fileName),
        provider: item.provider === "gemini" ? "gemini" : "stub",
        fields: sanitizeFields(item.fields),
        summary: str(item.summary, 400),
        warnings: normalizeStringArray(item.warnings).slice(0, 6)
      }
    ];
  });
}

export function parseReconciliation(value: unknown): ReconciliationLog | null {
  if (!isRecord(value)) return null;
  const applied: FieldOverride[] = Array.isArray(value.applied)
    ? value.applied.slice(0, 12).flatMap((a): FieldOverride[] =>
        isRecord(a) && str(a.field, 40)
          ? [{ field: str(a.field, 40), from: str(a.from, 200), to: str(a.to, 200), source: str(a.source, 180) || "documents" }]
          : []
      )
    : [];
  const keptOwn = Array.isArray(value.keptOwn)
    ? value.keptOwn.slice(0, 12).flatMap((k) =>
        isRecord(k) && str(k.field, 40)
          ? [
              {
                field: str(k.field, 40),
                userValue: str(k.userValue, 200),
                documentValue: str(k.documentValue, 200),
                source: str(k.source, 180) || "documents"
              }
            ]
          : []
      )
    : [];
  return {
    applied,
    keptOwn,
    addedToMedicalHistory: value.addedToMedicalHistory === true,
    addedToDisclosures: value.addedToDisclosures === true
  };
}
