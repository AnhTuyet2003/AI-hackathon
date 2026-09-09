import type { ApplicationInput, ComplexityBand, ComplexityResult, ExtractedFields, NERResult, SpecializationEntity } from "./types";

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

export function extractEntities(input: Pick<ApplicationInput, "medicalHistory" | "disclosures">, clinicalFields?: ExtractedFields): NERResult {
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

  return {
    entities,
    specialtiesRequired: Array.from(specialties),
    possibleSpecialties: [],
    confidence: entities.length ? 0.85 : clinicalFields !== undefined ? 0.35 : 0.9
  };
}

function bandFor(score: number): ComplexityBand {
  if (score <= 3) return "low";
  if (score <= 7) return "medium";
  return "high";
}

export function scoreComplexity(input: ApplicationInput, ner: NERResult, clinicalFields?: ExtractedFields): ComplexityResult {
  const applicationDrivers: string[] = [];
  let applicationScore = 1;

  if (input.sumAssured > 500_000) {
    applicationScore += 3;
    applicationDrivers.push(`Sum Assured $${input.sumAssured.toLocaleString("en-US")} > $500K`);
  } else if (input.sumAssured > 150_000) {
    applicationScore += 1;
    applicationDrivers.push(`Sum Assured $${input.sumAssured.toLocaleString("en-US")} > $150K`);
  }

  if (input.age > 60) {
    applicationScore += 2;
    applicationDrivers.push(`Applicant age ${input.age} > 60`);
  } else if (input.age > 45) {
    applicationScore += 1;
    applicationDrivers.push(`Applicant age ${input.age} > 45`);
  }

  const occupationHit = HIGH_RISK_OCCUPATIONS.find((o) => input.occupation.toLowerCase().includes(o));
  if (occupationHit) {
    applicationScore += 2;
    applicationDrivers.push(`Unusual/high-risk occupation: ${input.occupation}`);
  }

  if (ner.specialtiesRequired.length >= 2) {
    applicationScore += 3;
    applicationDrivers.push(`Multi-morbidity: ${ner.specialtiesRequired.join(" + ")}`);
  } else if (ner.specialtiesRequired.length === 1) {
    applicationScore += 2;
    applicationDrivers.push(`Medical history: ${ner.specialtiesRequired[0]}`);
  }

  if (/multiple|recurring|complication/i.test(input.medicalHistory)) {
    applicationScore += 1;
    applicationDrivers.push("Medical history flags recurring complications");
  }

  applicationScore = Math.max(1, Math.min(10, applicationScore));
  const clinical = scoreClinicalComplexity(clinicalFields, ner);
  // A multi-day or invasive hospital episode is operationally complex even when the intake
  // form itself is otherwise clean. Preserve the application factors, but avoid collapsing a
  // surgical case into a low application-only score before the weighted blend is applied.
  if (clinicalFields !== undefined && /admission|inpatient|surgery|surgical|operative|intravenous|multi-day/i.test(Object.values(clinicalFields).join(" "))) {
    applicationScore = Math.max(applicationScore, 5);
  }
  const score = clinicalFields === undefined
    ? applicationScore
    : Math.max(1, Math.min(10, Math.round(0.4 * applicationScore + 0.6 * clinical.score)));
  const band = bandFor(score);
  const drivers = [...applicationDrivers, ...clinical.evidence];

  const reasonCode = formatComplexityReason(score, applicationScore, clinical.score, drivers);

  return {
    score,
    caseComplexityScore: score,
    band,
    reasonCode,
    driverFactors: drivers,
    applicationComplexityScore: applicationScore,
    clinicalComplexityScore: clinical.score,
    complexityConfidence: clinical.confidence,
    complexityEvidence: clinical.evidence
  };
}

export function formatComplexityReason(
  score: number,
  applicationComplexityScore: number,
  clinicalComplexityScore: number,
  drivers: string[]
) {
  const detail = drivers.length ? ` driven by: ${drivers.join("; ")}.` : " no elevated risk factors detected.";
  return `Score ${score}/10 — application complexity ${applicationComplexityScore}/10 + clinical complexity ${clinicalComplexityScore}/10 = final case complexity ${score}/10.${detail}`;
}

export function scoreClinicalComplexity(fields: ExtractedFields | undefined, ner: NERResult) {
  if (fields === undefined) return { score: 1, confidence: 0.9, evidence: ["No uploaded clinical document; application-only complexity path."] };

  const text = Object.values(fields).filter((value) => typeof value === "string").join(" ").toLowerCase();
  const evidence: string[] = [];
  let score = 1;
  const dentalCase = /oral health|dental|tooth|molar|gum|root canal|restoration|crown/i.test(text);

  const severity = dentalCase
    ? [
        [/abscess|cellulitis|osteomyelitis|systemic infection|complication|emergency/i, 2, "Dental complication or urgent presentation"],
        [/multi-day|admission|inpatient/i, 1, "Extended or inpatient care"]
      ]
    : [
        [/severe|acute|peritonitis|sepsis|complication|unstable|emergency/i, 2, "Acute or severe clinical presentation"],
        [/admission|inpatient|operative|surgery|surgical|intravenous|multi-day/i, 1, "Hospital-level or invasive care"]
      ];
  let severityPoints = 0;
  for (const [pattern, points, label] of severity as [RegExp, number, string][]) {
    if (pattern.test(text)) { severityPoints = Math.min(3, severityPoints + points); evidence.push(label); }
  }
  score += severityPoints;

  if (dentalCase && /root canal|extraction|restoration|crown/i.test(text)) {
    score += 1;
    evidence.push("Dental procedure documented without automatic high-complexity escalation");
  } else if (/surgery|surgical|operative|appendectomy|invasive|procedure/i.test(text)) {
    score += 2;
    evidence.push("Procedure intensity requires clinical review");
  } else if (/treatment|prescription|medication|oral antiviral/i.test(text)) {
    score += 1;
    evidence.push("Active treatment or medication documented");
  }

  if (/ct|mri|ultrasound|radiograph|imaging|biopsy|rapid test|laboratory|lab result/i.test(text)) {
    score += /ct|mri|biopsy|multiple|follow-up laboratory/i.test(text) ? 2 : 1;
    evidence.push("Investigations or diagnostic testing documented");
  }
  if (/admission|release|ward|multi-day|clinical course/i.test(text)) {
    score += 1;
    evidence.push("Duration or multi-day clinical course documented");
  }
  if (ner.specialtiesRequired.length >= 2 || /general surgery|internal medicine/i.test(text)) {
    score += 1;
    evidence.push(`Specialty involvement: ${ner.specialtiesRequired.join(", ") || "clinical specialty"}`);
  }
  if (/unclear|ambiguous|contradict|unknown|incomplete|missing/i.test(text)) {
    score += 1;
    evidence.push("Ambiguity or contradiction requires review");
  }

  const fieldCount = Object.values(fields).filter((value) => value !== undefined && value !== null && value !== "").length;
  const heuristicConfidence = fieldCount === 0 ? 0.3 : fieldCount >= 8 ? 0.9 : 0.65;
  const requiredEvidenceCount = [
    fields.patientName || fields.policyNumber,
    fields.facilityName || fields.providerCode || fields.department,
    fields.serviceStart,
    fields.chiefComplaint || fields.symptoms,
    fields.treatment || fields.procedures,
    fields.diagnosis || fields.diagnosisCode
  ].filter((value) => typeof value === "string"
    ? value.trim().length > 0 && !/^(?:not available|unavailable|unknown|not provided|none|n\/a|na)$/i.test(value.trim())
    : Boolean(value)).length;
  const evidenceConfidence = requiredEvidenceCount < 4 ? 0.45 : heuristicConfidence;
  const confidence = fields.extractionConfidence == null
    ? evidenceConfidence
    : Math.min(evidenceConfidence, Math.max(0, Math.min(1, fields.extractionConfidence)));
  return { score: Math.max(1, Math.min(10, score)), confidence, evidence };
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
