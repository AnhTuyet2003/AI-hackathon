/**
 * AI-backed care category classifier.
 *
 * Uses the already-extracted structured fields from document-ingest (department,
 * serviceEnd, clinicalCourse, diagnosisCode, procedures) plus the raw text to
 * make a single structured-output call to Gemini that returns the CareEvidence
 * shape directly. Falls back to the keyword-based classifyCareDocuments() when
 * the API is unavailable or the response fails validation.
 *
 * This avoids the key failure mode of the keyword classifier: real-world PDFs
 * extracted by Gemini rarely contain the literal words "inpatient"/"outpatient";
 * they use clinical language ("admitted", "hospital stay", "clinic visit") that
 * the LLM understands but regex does not.
 */

import { GoogleGenAI } from "@google/genai";
import {
  type CareEvidence,
  type CareSubmission,
  parseCareEvidence,
} from "./care-routing";
import type { DocumentExtraction } from "./types";

const MODEL = "gemini-3.1-flash-lite";

const CARE_CLASSIFIER_PROMPT = `You are the Care Category Classifier inside an insurance Underwriting Dispatcher.

Your job is to evaluate the medical evidence and classify exactly which type of care is supported.

The three care categories are:
- Inpatient: formal hospital admission with an overnight stay, multi-day stay, or surgical admission. Signals: admission/discharge dates (serviceEnd present), ward/room assignment, surgical procedures, operative reports, hospital bills.
- Outpatient: same-day clinic visit, consultation, or ambulatory procedure. Signals: single service date with no discharge date, GP/clinic/family medicine department, consultation reports.
- Dental: any dental or oral health procedure. Signals: dental department, ICD-10 codes K00-K14, procedures like extraction, root canal, crown, filling.

Rules:
1. Evaluate each category INDEPENDENTLY based only on the evidence present.
2. "supported" = clear, unambiguous evidence for that category exists.
3. "uncertain" = some signals present but not conclusive (e.g., "emergency department observation" could be inpatient or outpatient).
4. "not_supported" = no evidence for that category.
5. Each citation must be an exact substring from the document text provided.
6. If a category is "supported" or "uncertain", you MUST include at least one citation.
7. Do not infer from document type or filename. Base your decision only on the content.

Return ONLY valid JSON matching this exact shape, no prose:
{
  "Inpatient": {
    "state": "supported" | "not_supported" | "uncertain",
    "citations": [{ "documentId": "D1", "quote": "<exact substring from document>" }]
  },
  "Outpatient": {
    "state": "supported" | "not_supported" | "uncertain",
    "citations": [{ "documentId": "D1", "quote": "<exact substring from document>" }]
  },
  "Dental": {
    "state": "supported" | "not_supported" | "uncertain",
    "citations": [{ "documentId": "D1", "quote": "<exact substring from document>" }]
  }
}`;

function buildContext(
  extractions: DocumentExtraction[],
  documents: { id: string; text: string }[],
): string {
  const parts: string[] = [];
  for (let i = 0; i < extractions.length; i++) {
    const e = extractions[i];
    const f = e.fields;
    const docId = `D${i + 1}`;
    const structuredSummary = [
      f.department && `Department: ${f.department}`,
      f.facilityName && `Facility: ${f.facilityName}`,
      f.serviceStart && `Service start: ${f.serviceStart}`,
      f.serviceEnd && `Service end: ${f.serviceEnd}`,
      f.clinicalCourse && `Clinical course: ${f.clinicalCourse}`,
      f.diagnosis && `Diagnosis: ${f.diagnosis}`,
      f.diagnosisCode && `Diagnosis code: ${f.diagnosisCode}`,
      f.procedures && `Procedures: ${f.procedures}`,
      f.chiefComplaint && `Chief complaint: ${f.chiefComplaint}`,
      f.treatment && `Treatment: ${f.treatment}`,
    ]
      .filter(Boolean)
      .join("\n");

    parts.push(
      `--- Document ${docId}: ${e.fileName} ---\nExtracted structured fields:\n${structuredSummary || "(no structured fields)"}\n\nRaw text:\n${documents[i]?.text?.slice(0, 4000) || "(no raw text)"}`,
    );
  }
  return parts.join("\n\n");
}

/**
 * Classify care documents using Gemini structured output.
 * Returns null if the API is unavailable — caller must fall back to keyword classifier.
 */
export async function classifyWithGeminiAI(
  extractions: DocumentExtraction[],
  documents: { id: string; text: string }[],
  submission: CareSubmission,
): Promise<CareEvidence | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const context = buildContext(extractions, documents);
    const prompt = `${CARE_CLASSIFIER_PROMPT}\n\n${context}`;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ text: prompt }],
      config: {
        responseMimeType: "application/json",
        httpOptions: { timeout: 12000 },
      },
    });

    const raw = response.text ?? "{}";
    // Strip markdown fences if present
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return null;
    }

    // Validate the structure using the existing parseCareEvidence validator
    // which also verifies citation quotes exist in the actual document text
    try {
      return parseCareEvidence(parsed, submission);
    } catch {
      // Gemini returned structurally invalid evidence — fall through to keyword classifier
      return null;
    }
  } catch {
    // Network error, quota exceeded, timeout, etc.
    return null;
  }
}

/**
 * Keyword-based deterministic fallback classifier.
 * Identical to the original classifyCareDocuments but re-exported from here
 * for clarity — this is the offline/no-API path.
 */
export { classifyCareDocuments } from "./care-classifier";
