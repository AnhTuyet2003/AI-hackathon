import type { ApplicationInput, ComplexityBand, ComplexityResult, NERResult, SpecializationEntity } from "./types";

// Deterministic, zero-API-call engine for the Complexity Classifier (Component A) and the NER
// Specialization Extractor (Component B). Mirrors CoverOps-AI's lib/mock-ai.ts pattern: this must
// always produce a valid result on its own so the pipeline never hard-depends on a live LLM.

const HIGH_RISK_OCCUPATIONS = ["offshore drilling", "mining", "commercial pilot", "deep sea diver", "demolition", "firefighter"];

// Keyword -> specialization mapping used by the NER extractor.
const SPECIALIZATION_KEYWORDS: Array<{ pattern: RegExp; specialization: string }> = [
  { pattern: /type\s?2 diabetes|diabetes|hba1c/i, specialization: "Endocrinology" },
  { pattern: /myocardial infarction|cardiac|heart|hypertension|coronary/i, specialization: "Cardiology" },
  { pattern: /cancer|tumor|oncology|carcinoma|chemotherapy/i, specialization: "Oncology" },
  { pattern: /liver|hepatic|cirrhosis/i, specialization: "Complex Medical" },
  { pattern: /kidney|renal|dialysis/i, specialization: "Complex Medical" },
  { pattern: /stroke|neurological|seizure/i, specialization: "Complex Medical" }
];

export function extractEntities(input: Pick<ApplicationInput, "medicalHistory" | "disclosures">): NERResult {
  const text = `${input.medicalHistory} ${input.disclosures}`;
  const entities: SpecializationEntity[] = [];
  const specialties = new Set<string>();

  for (const { pattern, specialization } of SPECIALIZATION_KEYWORDS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({ text: match[0], specialization });
      specialties.add(specialization);
    }
  }

  return { entities, specialtiesRequired: Array.from(specialties) };
}

function bandFor(score: number): ComplexityBand {
  if (score <= 3) return "low";
  if (score <= 7) return "medium";
  return "high";
}

export function scoreComplexity(input: ApplicationInput, ner: NERResult): ComplexityResult {
  const drivers: string[] = [];
  let score = 1;

  if (input.sumAssured > 500_000) {
    score += 3;
    drivers.push(`Sum Assured $${input.sumAssured.toLocaleString("en-US")} > $500K`);
  } else if (input.sumAssured > 150_000) {
    score += 1;
    drivers.push(`Sum Assured $${input.sumAssured.toLocaleString("en-US")} > $150K`);
  }

  if (input.age > 60) {
    score += 2;
    drivers.push(`Applicant age ${input.age} > 60`);
  } else if (input.age > 45) {
    score += 1;
    drivers.push(`Applicant age ${input.age} > 45`);
  }

  const occupationHit = HIGH_RISK_OCCUPATIONS.find((o) => input.occupation.toLowerCase().includes(o));
  if (occupationHit) {
    score += 2;
    drivers.push(`Unusual/high-risk occupation: ${input.occupation}`);
  }

  if (ner.specialtiesRequired.length >= 2) {
    score += 3;
    drivers.push(`Multi-morbidity: ${ner.specialtiesRequired.join(" + ")}`);
  } else if (ner.specialtiesRequired.length === 1) {
    score += 2;
    drivers.push(`Medical history: ${ner.specialtiesRequired[0]}`);
  }

  if (/multiple|recurring|complication/i.test(input.medicalHistory)) {
    score += 1;
    drivers.push("Medical history flags recurring complications");
  }

  score = Math.max(1, Math.min(10, score));
  const band = bandFor(score);

  const reasonCode =
    drivers.length > 0
      ? `Score ${score} -- driven by: ${drivers.join("; ")}.`
      : `Score ${score} -- clean case, no elevated risk factors detected.`;

  return { score, band, reasonCode, driverFactors: drivers };
}

export function detectMissingFields(input: ApplicationInput): { missingFields: string[]; followUpMessage: string } {
  const missing: string[] = [];
  if (!input.applicantName.trim()) missing.push("applicant name");
  if (!input.occupation.trim()) missing.push("occupation");
  if (!input.medicalHistory.trim()) missing.push("medical history / doctor notes");
  if (input.sumAssured > 200_000 && !input.disclosures.trim()) missing.push("financial disclosures");
  if (input.documents.length === 0) missing.push("supporting documents");

  const followUpMessage =
    missing.length === 0
      ? "No missing fields detected -- application package is complete."
      : `We're missing the following to proceed with underwriting: ${missing.join(", ")}. Please upload/provide these at your earliest convenience.`;

  return { missingFields: missing, followUpMessage };
}
