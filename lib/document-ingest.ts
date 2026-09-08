import { GoogleGenAI } from "@google/genai";
import {
  autoMergeExtractions,
  kindFromName,
  normalizeKind,
  normalizeStringArray,
  summarizeExtraction
} from "./reconcile";
import type { ApplicationInput, DocumentExtraction, DocumentKind, ExtractedFields, IngestionResult } from "./types";

// Data Ingestion Engine (build spec Sect. 3, step 2): OCR / vision extraction of uploaded
// supporting documents.
//
// Adapted from the PAX reference project (github.com/jreivilo/baselhacks_pax), which uploads a
// PDF/image, base64-encodes it, and asks OpenAI Vision to call a fixed `extract_form_data`
// function. Here the same idea runs through Gemini's multimodal `generateContent` with a JSON
// response schema. Every failure path (no API key, quota, network, unreadable file) degrades to a
// deterministic filename-keyed stub so the demo still runs offline.
//
// Extraction is now decoupled from merging: the Submit page calls extractDocuments() the moment
// files are attached and lets the submitter reconcile the differences (see lib/reconcile.ts).
// runDocumentIngestion() keeps the old extract-then-auto-merge behaviour for direct API callers
// and the offline seed.

export type UploadedFile = { name: string; mimeType: string; dataBase64: string };

const MODEL = "gemini-3.1-flash-lite";

const EXTRACTION_PROMPT = `You are the Document Ingestion Engine inside an insurance Underwriting Dispatcher.
Read the attached supporting document (a medical report, financial statement, ID, or application form)
and return ONLY valid JSON, no prose, matching this shape:

{
  "kind": "medical" | "financial" | "identity" | "application" | "other",
  "age": number | null,
  "sumAssured": number | null,
  "occupation": string | null,
  "productLine": string | null,
  "smoker": true | false | null,
  "packsPerWeek": number | null,
  "heightCm": number | null,
  "weightKg": number | null,
  "bmi": number | null,
  "annualIncome": number | null,
  "maritalStatus": string | null,
  "medicalConditions": string[],
  "medications": string[],
  "dangerousSports": string[],
  "disclosuresText": string | null,
  "medicalSummary": string | null,
  "warnings": string[]
}

Rules:
- Only report a value if the document clearly supports it; otherwise use null (or [] for arrays).
- Normalise numbers: heightCm in centimetres, weightKg in kilograms, incomes and sumAssured as plain integers.
- medicalConditions / medications: short canonical names ("Type 2 Diabetes", "Myocardial Infarction", "Lisinopril").
- medicalSummary: one neutral sentence describing the document's clinical picture, or null.
- warnings: note anything low-confidence or ambiguous (e.g. "handwriting unclear for age").`;

// Extraction only -- no merge. Safe to call as soon as files are attached.
export async function extractDocuments(files: UploadedFile[]): Promise<DocumentExtraction[]> {
  if (!files.length) return [];

  const apiKey = process.env.GEMINI_API_KEY;
  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

  const extractions: DocumentExtraction[] = [];
  for (const file of files) {
    try {
      if (!ai) throw new Error("GEMINI_API_KEY is not configured.");
      extractions.push(await extractWithGemini(ai, file));
    } catch (error) {
      extractions.push(stubExtract(file, error instanceof Error ? error.message : "extraction failed"));
    }
  }
  return extractions;
}

// Extract + auto-merge (document wins). Direct-API / seed path.
export async function runDocumentIngestion(
  input: ApplicationInput,
  files: UploadedFile[]
): Promise<{ input: ApplicationInput; ingestion: IngestionResult }> {
  const extractions = await extractDocuments(files);
  if (!extractions.length) {
    return {
      input,
      ingestion: { extractions: [], filledFields: [], overriddenFields: [], appendedToMedicalHistory: false, mode: "auto", reconciliation: null }
    };
  }
  return autoMergeExtractions(input, extractions);
}

async function extractWithGemini(ai: GoogleGenAI, file: UploadedFile): Promise<DocumentExtraction> {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      { text: EXTRACTION_PROMPT },
      { inlineData: { mimeType: file.mimeType, data: file.dataBase64 } }
    ],
    config: { responseMimeType: "application/json" }
  });

  const parsed = safeParse(response.text || "{}");
  if (!isRecord(parsed)) throw new Error("Gemini returned an unusable response shape.");

  const fields = normalizeFields(parsed);
  return {
    fileName: file.name,
    mimeType: file.mimeType,
    kind: normalizeKind(parsed.kind) ?? kindFromName(file.name),
    provider: "gemini",
    fields,
    summary: summarizeExtraction(fields, file.name),
    warnings: normalizeStringArray(parsed.warnings)
  };
}

// ------------------------------------------------------------------------------------------------
// Deterministic offline stub. Cannot read a binary PDF/image, so it keys off the filename and
// returns a small canned field set for the recognisable demo document names. Clearly labelled
// provider: "stub" everywhere it surfaces so it is never mistaken for a real extraction.
// ------------------------------------------------------------------------------------------------
const STUB_LIBRARY: Array<{ match: RegExp; kind: DocumentKind; fields: ExtractedFields }> = [
  {
    match: /doctor|physician|clinical|ehr/i,
    kind: "medical",
    fields: {
      smoker: false,
      medicalConditions: ["Controlled hypertension"],
      medicalSummary: "Physician letter: one stable chronic condition, no active investigations."
    }
  },
  {
    match: /medical|questionnaire|health/i,
    kind: "medical",
    fields: {
      smoker: false,
      medicalConditions: [],
      medicalSummary: "Completed health questionnaire: no conditions declared."
    }
  },
  {
    match: /financial|statement|income|hnw/i,
    kind: "financial",
    fields: {
      annualIncome: 120_000,
      disclosuresText: "Financial statement on file supports the declared Sum Assured."
    }
  },
  {
    match: /id-|identity|passport|kyc/i,
    kind: "identity",
    fields: { maritalStatus: "married" }
  }
];

function stubExtract(file: UploadedFile, reason: string): DocumentExtraction {
  const hit = STUB_LIBRARY.find((entry) => entry.match.test(file.name));
  const fields = hit?.fields ?? {};
  return {
    fileName: file.name,
    mimeType: file.mimeType,
    kind: hit?.kind ?? kindFromName(file.name),
    provider: "stub",
    fields,
    summary: summarizeExtraction(fields, file.name),
    warnings: [`Offline stub used (${reason}). Fields inferred from the file name, not parsed from content.`]
  };
}

function normalizeFields(parsed: Record<string, unknown>): ExtractedFields {
  const fields: ExtractedFields = {};
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

  fields.age = num(parsed.age);
  fields.sumAssured = num(parsed.sumAssured);
  fields.occupation = str(parsed.occupation);
  fields.productLine = str(parsed.productLine);
  if (parsed.smoker === true || parsed.smoker === false) fields.smoker = parsed.smoker;
  fields.packsPerWeek = num(parsed.packsPerWeek);
  fields.heightCm = num(parsed.heightCm);
  fields.weightKg = num(parsed.weightKg);
  fields.bmi = num(parsed.bmi);
  fields.annualIncome = num(parsed.annualIncome);
  fields.maritalStatus = str(parsed.maritalStatus);
  fields.medicalConditions = normalizeStringArray(parsed.medicalConditions);
  fields.medications = normalizeStringArray(parsed.medications);
  fields.dangerousSports = normalizeStringArray(parsed.dangerousSports);
  fields.disclosuresText = str(parsed.disclosuresText);
  fields.medicalSummary = str(parsed.medicalSummary);

  for (const key of ["medicalConditions", "medications", "dangerousSports"] as const) {
    if (!fields[key]?.length) delete fields[key];
  }
  return fields;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
