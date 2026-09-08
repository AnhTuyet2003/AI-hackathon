import { GoogleGenAI } from "@google/genai";
import { detectMissingFields, extractEntities, formatComplexityReason, scoreComplexity } from "./mock-ai";
import type { ApplicationInput, ComplexityResult, ExtractedFields, NERResult } from "./types";

export type GeminiAnalysis = { complexity: ComplexityResult; ner: NERResult };

// Live LLM path for Component A (Complexity Classifier) + Component B (NER Specialization
// Extractor), run as a single structured-output call. Throws on any failure so the caller
// (app/api/cases/process/route.ts) can fall back to the deterministic engine in lib/mock-ai.ts --
// the fallback is not optional, it's what keeps the demo alive with no API key / quota / network.

export async function runGeminiAnalysis(input: ApplicationInput, clinicalFields?: ExtractedFields): Promise<GeminiAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `
You are the AI engine inside an insurance Underwriting Dispatcher. Analyze this new business
application and return only valid JSON, no prose.

Application:
${JSON.stringify(input, null, 2)}

Clinical evidence extracted from uploaded documents:
${JSON.stringify(clinicalFields ?? {}, null, 2)}

Return an object with:
- score: integer 1-10 complexity score (1-3 low/clean, 4-7 medium/minor disclosures, 8-10 high/complex multi-morbidity or HNW or unusual occupation)
- band: "low" | "medium" | "high" (must match score)
- reasonCode: one sentence, human-readable, in the style "Score 8 -- driven by: cardiac history + Sum Assured > $500K"
- driverFactors: string[] short bullet-style factors that drove the score
- entities: array of {text, specialization} extracted from medicalHistory/disclosures (e.g. {"text": "Myocardial Infarction", "specialization": "Cardiology"})
- specialtiesRequired: string[] unique specialization tags implied by entities (e.g. "Cardiology", "Oncology", "Endocrinology", "Complex Medical")
`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });

  return normalizeGeminiOutput(response.text || "{}", input, clinicalFields);
}

function normalizeGeminiOutput(rawText: string, input: ApplicationInput, clinicalFields?: ExtractedFields): GeminiAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Gemini returned invalid JSON.");
  }
  if (!isRecord(parsed)) throw new Error("Gemini returned an invalid response shape.");

  // Gemini may over-infer a specialty from generic symptoms. Confirm entities only when the
  // deterministic application evidence contains a known condition; document-only symptoms stay
  // possible/unknown and cannot become underwriting requirements.
  const fallbackNer = extractEntities(input, clinicalFields);
  const entities = fallbackNer.entities;
  const specialtiesRequired = fallbackNer.specialtiesRequired;
  const ner: NERResult = {
    entities,
    specialtiesRequired,
    possibleSpecialties: fallbackNer.possibleSpecialties,
    confidence: clinicalFields !== undefined ? Math.min(fallbackNer.confidence, 0.5) : entities.length ? 0.85 : 0.8
  };

  const deterministic = scoreComplexity(input, ner, clinicalFields);
  const score = clinicalFields === undefined ? normalizeScore(parsed.score) : deterministic.score;
  const band = clinicalFields === undefined
    ? (parsed.band === "low" || parsed.band === "medium" || parsed.band === "high" ? parsed.band : bandForScore(score))
    : deterministic.band;
  const driverFactors = clinicalFields === undefined ? normalizeStringArray(parsed.driverFactors) : deterministic.driverFactors;
  const reasonCode = formatComplexityReason(
    score,
    clinicalFields === undefined ? score : deterministic.applicationComplexityScore,
    clinicalFields === undefined ? 1 : deterministic.clinicalComplexityScore,
    driverFactors
  );

  const complexity: ComplexityResult = clinicalFields === undefined
    ? {
        score,
        caseComplexityScore: score,
        band,
        reasonCode,
        driverFactors,
        applicationComplexityScore: score,
        clinicalComplexityScore: 1,
        complexityConfidence: 0.85,
        complexityEvidence: ["Application-level Gemini complexity assessment."]
      }
    : { ...deterministic, score, band: bandForScore(score), reasonCode, driverFactors };

  return { complexity, ner };
}

function bandForScore(score: number): ComplexityResult["band"] {
  if (score <= 3) return "low";
  if (score <= 7) return "medium";
  return "high";
}

function normalizeScore(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 5;
  return Math.min(10, Math.max(1, Math.round(numeric)));
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export { detectMissingFields };
