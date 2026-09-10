import type { CareCategory } from "./care-routing";
import { affirmativeText, realDate } from "./evidence-text";
import { INTAKE_POLICY } from "./intake-policy";
import type {
  Contradiction,
  ContradictionReasonCode,
  DocumentExtraction,
  DocumentQualityEvaluation,
  ExtractedFields,
  FieldEvaluation,
  FieldStatus,
} from "./types";

// Document-quality evaluation is deliberately separate from underwriting risk scoring. A claim
// record can be clinically complete even when the applicant is high risk, and a polished-looking
// document can still fail if its dates, diagnosis, or billing do not agree.

type ReferenceProfile = {
  name: string;
  signals: Array<{ label: string; pattern: RegExp; weight: number }>;
  optional: Set<keyof ExtractedFields>;
};

const PROFILES: ReferenceProfile[] = [
  {
    name: "Inpatient medical or surgical care",
    signals: [
      {
        label: "surgical department or diagnosis",
        pattern: /general surgery|surgery|appendicitis|peritonitis|appendix/i,
        weight: 3,
      },
      { label: "inpatient location", pattern: /ward|room/i, weight: 2 },
      {
        label: "multi-day admission or release",
        pattern: /admission|arrival|release|multi-day/i,
        weight: 2,
      },
      {
        label: "operative or intravenous treatment",
        pattern: /operative report|surgical removal|intravenous|appendectomy/i,
        weight: 3,
      },
    ],
    optional: new Set<keyof ExtractedFields>(["dischargeInstructions"]),
  },
  {
    name: "Outpatient medical care",
    signals: [
      {
        label: "clinic department or facility",
        pattern: /internal medicine|family medicine|clinic|exam room/i,
        weight: 3,
      },
      {
        label: "same-day visit",
        pattern: /visit date|same-day|outpatient|home/i,
        weight: 2,
      },
      {
        label: "vital signs or rapid tests",
        pattern:
          /vital signs|oxygen saturation|rapid influenza|rapid streptococcal/i,
        weight: 2,
      },
      {
        label: "prescription or home recovery",
        pattern: /prescription|recover at home|oral antiviral|rest/i,
        weight: 2,
      },
    ],
    optional: new Set<keyof ExtractedFields>([
      "dischargeInstructions",
      "vitalSigns",
    ]),
  },
  {
    name: "Dental care",
    signals: [
      {
        label: "oral-health provider or department",
        pattern: /oral health|dental/i,
        weight: 3,
      },
      {
        label: "tooth or gum evidence",
        pattern: /tooth|molar|gum|decay/i,
        weight: 2,
      },
      {
        label: "dental examination or radiograph",
        pattern:
          /oral examination|dental radiograph|periapical radiograph|radiograph/i,
        weight: 2,
      },
      {
        label: "root canal or restoration",
        pattern: /root canal|restoration|crown/i,
        weight: 3,
      },
    ],
    optional: new Set<keyof ExtractedFields>([
      "vitalSigns",
      "roomOrServiceLocation",
    ]),
  },
];

const usableEvidenceValue = (value: unknown) => {
  if (typeof value === "string" ? value.trim().length === 0 : value == null)
    return false;
  if (typeof value !== "string") return true;
  return !/(?:not available|unavailable|not provided|not included|unknown|n\/a)/i.test(
    value,
  );
};
const removeNegativeStatements = (value: string) =>
  value
    .replace(
      /[^.!?]*(?:not available|unavailable|not provided|not included|unknown|n\/a)[^.!?]*[.!?]?/gi,
      "",
    )
    .trim();
const usableNarrativeValue = (value: unknown) =>
  typeof value === "string" && removeNegativeStatements(value).length > 0;
const profileEvidenceText = (f: ExtractedFields) =>
  Object.values(f)
    .filter((value) => typeof value === "string")
    .map((value) => affirmativeText(removeNegativeStatements(value as string)))
    .filter(Boolean)
    .join(" ");

export function evaluateDocumentQuality(
  extractions: DocumentExtraction[],
  engineUsed: DocumentQualityEvaluation["engineUsed"] = "deterministic-fallback",
  category?: CareCategory,
): DocumentQualityEvaluation {
  const fields = mergeClaimFields(extractions.map((e) => e.fields));
  const text = profileEvidenceText(fields);
  const inferred = inferProfile(text);
  const profile = category
    ? PROFILES[{ Inpatient: 0, Outpatient: 1, Dental: 2 }[category]]
    : inferred.profile;
  const profileMatches = profile.signals
    .filter((signal) => signal.pattern.test(text))
    .map((signal) => signal.label);
  const missingFields: string[] = [];
  const partialFields: string[] = [];
  const completeFields: string[] = [];
  const notApplicableFields: string[] = [];
  const contradictions: Contradiction[] = [];
  const matchedReferenceFields: string[] = [];
  const scoreBreakdown: DocumentQualityEvaluation["scoreBreakdown"] = [];
  const fieldEvaluations: FieldEvaluation[] = [];
  const drivers: DocumentQualityEvaluation["driverFactors"] = [];

  const dimensions: Array<{
    key: keyof ExtractedFields;
    label: string;
    present: boolean;
    partial?: boolean;
  }> = [
    {
      key: "patientName",
      label: "Patient and policy information",
      present:
        usableEvidenceValue(fields.patientName) &&
        usableEvidenceValue(fields.policyNumber),
      partial:
        usableEvidenceValue(fields.patientName) ||
        usableEvidenceValue(fields.policyNumber),
    },
    {
      key: "facilityName",
      label: "Provider and facility information",
      present:
        usableEvidenceValue(fields.facilityName) &&
        usableEvidenceValue(fields.providerCode) &&
        usableEvidenceValue(fields.department),
      partial:
        usableEvidenceValue(fields.facilityName) ||
        usableEvidenceValue(fields.department),
    },
    {
      key: "serviceStart",
      label: "Date and service timeline",
      present:
        usableEvidenceValue(fields.serviceStart) &&
        realDate(fields.serviceStart!),
      partial:
        usableEvidenceValue(fields.serviceEnd) && realDate(fields.serviceEnd!),
    },
    {
      key: "chiefComplaint",
      label: "Presenting symptoms",
      present:
        usableEvidenceValue(fields.chiefComplaint) &&
        usableEvidenceValue(fields.symptoms),
      partial:
        usableEvidenceValue(fields.chiefComplaint) ||
        usableEvidenceValue(fields.symptoms),
    },
    {
      key: "relevantMedicalHistory",
      label: "Relevant medical history",
      present: usableEvidenceValue(fields.relevantMedicalHistory),
      partial: false,
    },
    {
      key: "physicalFindings",
      label: "Clinical examination and findings",
      present:
        usableEvidenceValue(fields.physicalFindings) ||
        usableEvidenceValue(fields.vitalSigns),
      partial:
        usableEvidenceValue(fields.physicalFindings) ||
        usableEvidenceValue(fields.vitalSigns),
    },
    {
      key: "investigations",
      label: "Investigations and results",
      present:
        usableEvidenceValue(fields.investigations) &&
        usableEvidenceValue(fields.testResults),
      partial:
        usableEvidenceValue(fields.investigations) ||
        usableEvidenceValue(fields.testResults),
    },
    {
      key: "treatment",
      label: "Treatment, medication, or procedure details",
      present:
        usableEvidenceValue(fields.treatment) &&
        usableEvidenceValue(fields.procedures),
      partial:
        usableEvidenceValue(fields.treatment) ||
        usableEvidenceValue(fields.procedures),
    },
    {
      key: "diagnosis",
      label: "Diagnosis and medical coding",
      present:
        usableEvidenceValue(fields.diagnosis) &&
        usableEvidenceValue(fields.diagnosisCode),
      partial:
        usableEvidenceValue(fields.diagnosis) ||
        usableEvidenceValue(fields.diagnosisCode),
    },
    {
      key: "supportingDocuments",
      label: "Supporting documents and billing consistency",
      present:
        usableEvidenceValue(fields.supportingDocuments) &&
        billingIsPlausible(fields),
      partial:
        usableEvidenceValue(fields.supportingDocuments) ||
        billingIsPlausible(fields),
    },
  ];

  let score = 0;
  let applicableCount = 0;
  for (const dimension of dimensions) {
    const applicable = !(
      dimension.key === "investigations" &&
      /not (?:clinically )?indicated|not applicable/i.test(
        fields.investigations ?? "",
      )
    );
    if (!applicable) {
      // NOT_APPLICABLE dimensions are excluded from the denominator entirely.
      // Spec: finalScore = clamp(baseScore - penalties, 0, 10) where baseScore is
      // computed only over applicable dimensions. Adding 1 here would artificially
      // inflate scores for dental/same-day cases where some clinical fields don't apply.
      notApplicableFields.push(dimension.label);
      fieldEvaluations.push({ field: dimension.key, label: dimension.label, status: "NOT_APPLICABLE", points: 0, reason: `Not clinically required for ${profile.name}; excluded from score denominator.` });
      scoreBreakdown.push({ dimension: dimension.label, points: 0, explanation: `Not clinically required for ${profile.name}; excluded from score denominator.` });
      matchedReferenceFields.push(`${dimension.label} (not required for ${profile.name})`);
      drivers.push({ factor: dimension.label, impact: "neutral", points: 0, explanation: `Excluded from scoring denominator for the ${profile.name} profile.` });
    } else {
      // Applicable dimension: count it toward the denominator, then score it.
      applicableCount++;
      if (dimension.present) {
        score += 1;
        completeFields.push(dimension.label);
        fieldEvaluations.push({ field: dimension.key, label: dimension.label, status: "COMPLETE", points: 1, reason: "Clear, relevant, and sufficiently complete." });
        scoreBreakdown.push({ dimension: dimension.label, points: 1, explanation: "Present, clear, and sufficiently consistent." });
        matchedReferenceFields.push(dimension.label);
        drivers.push({ factor: dimension.label, impact: "positive", points: 1, explanation: "Evidence is present and sufficiently specific." });
      } else if (dimension.partial) {
        score += 0.5;
        partialFields.push(dimension.label);
        const reason = partialReason(dimension.label, fields);
        fieldEvaluations.push({ field: dimension.key, label: dimension.label, status: "PARTIAL", points: 0.5, reason });
        scoreBreakdown.push({ dimension: dimension.label, points: 0.5, explanation: reason });
        drivers.push({ factor: dimension.label, impact: "negative", points: 0.5, explanation: reason });
      } else {
        missingFields.push(dimension.label);
        fieldEvaluations.push({ field: dimension.key, label: dimension.label, status: "MISSING", points: 0, reason: "No usable evidence was extracted." });
        scoreBreakdown.push({ dimension: dimension.label, points: 0, explanation: "Missing or unreadable." });
        drivers.push({ factor: dimension.label, impact: "negative", points: 0, explanation: "Expected evidence was not found." });
      }
    }
  }
  const rawScore = score;
  score = round1((score * 10) / Math.max(1, 10 - notApplicableFields.length));
  if (score !== rawScore)
    scoreBreakdown.push({
      dimension: "Applicability normalization adjustment",
      points: round1(score - rawScore),
      explanation: "Scale applicable dimensions to ten points.",
    });
  const baseScore = round1(rawScore);
  addConsistencyChecks(fields, contradictions);
  const contradictionPenalty = contradictions.reduce(
    (total, item) => total + item.penalty,
    0,
  );
  if (contradictions.length) {
    score = Math.max(0, score - contradictionPenalty);
    scoreBreakdown.push({
      dimension: "Contradiction penalties",
      points: -contradictionPenalty,
      explanation: contradictions
        .map((item) => `${item.code}: ${item.message} (-${item.penalty})`)
        .join(" "),
    });
    drivers.push({
      factor: "Internal consistency",
      impact: "negative",
      points: -contradictionPenalty,
      explanation: contradictions
        .map((item) => `${item.message} (-${item.penalty})`)
        .join(" "),
    });
  } else {
    scoreBreakdown.push({
      dimension: "Consistency adjustment",
      points: 0,
      explanation: "No contradictions detected.",
    });
    drivers.push({
      factor: "Internal consistency",
      impact: "positive",
      points: 0,
      explanation:
        "Dates and financial amounts are plausible for a claim record.",
    });
  }

  const completenessScore = round1(
    dimensions.reduce(
      (sum, d) => sum + (d.present ? 1 : d.partial ? 0.5 : 0),
      0,
    ),
  );
  const consistencyScore = contradictions.length
    ? Math.max(0, round1(10 - contradictions.length * 2))
    : 10;
  const readabilityProblems = extractions.flatMap((e) =>
    e.readable === false ? e.warnings : [],
  );
  const readabilityScore =
    !extractions.length ||
    extractions.some((e) => e.readable === false || !e.rawText?.trim())
      ? 0
      : 10;
  const semantic = calculateSemanticMatch(fields, profile, profileMatches);
  const semanticMatchScore = semantic.score;
  const semanticProfileKnown = semantic.score >= 0.5;
  const detectedMedicalProfile = semanticProfileKnown
    ? profile.name
    : "Unclassified medical evidence";
  const profileEvidence = semanticProfileKnown ? profileMatches : [];
  const semanticEvidence = semanticProfileKnown
    ? semantic.evidence
    : [
        `Semantic match ${(semantic.score * 100).toFixed(0)}% is below the 50% profile threshold; profile remains unknown.`,
      ];
  const semanticPenalty = semantic.score < 0.5 ? 0.5 : 0;
  const confidence = !semanticProfileKnown
    ? 0.45
    : Math.min(
        0.85,
        ...extractions.map((e) => e.fields.extractionConfidence ?? 0.82),
      );
  const requiredMissing = [
    usableEvidenceValue(fields.patientName) ||
      usableEvidenceValue(fields.policyNumber),
    usableEvidenceValue(fields.facilityName) ||
      usableEvidenceValue(fields.providerCode) ||
      usableEvidenceValue(fields.department),
    usableEvidenceValue(fields.serviceStart) && realDate(fields.serviceStart!),
    usableEvidenceValue(fields.chiefComplaint) ||
      usableEvidenceValue(fields.symptoms),
    usableEvidenceValue(fields.treatment) ||
      usableEvidenceValue(fields.procedures),
    usableEvidenceValue(fields.diagnosis) ||
      usableEvidenceValue(fields.diagnosisCode),
  ].filter((present) => !present).length;
  if (requiredMissing > 0) {
    const capDelta = Math.min(score, 7.5) - score;
    score += capDelta;
    scoreBreakdown.push({
      dimension: "Required evidence cap",
      points: capDelta,
      explanation: `${requiredMissing} required clinical fields are missing; score capped at 7.5.`,
    });
  }
  if (semantic.score < 0.5) {
    const delta = Math.min(score - semanticPenalty, 7.5) - score;
    score += delta;
    scoreBreakdown.push({
      dimension: "Semantic match penalty and cap",
      points: delta,
      explanation: `Semantic match ${(semantic.score * 100).toFixed(0)}% is below the 50% minimum.`,
    });
  }
  if (contradictions.some((c) => c.penalty > 0)) {
    const delta = Math.min(score, 7.5) - score;
    score += delta;
    scoreBreakdown.push({
      dimension: "Contradiction validation cap",
      points: delta,
      explanation:
        "Impossible or contradictory evidence must be corrected before assignment.",
    });
  }
  const finalScore = round1(Math.min(10, Math.max(0, score)));
  const breakdownTotal = scoreBreakdown.reduce((n, r) => n + r.points, 0);
  if (Math.abs(finalScore - breakdownTotal) > 0.001)
    scoreBreakdown.push({
      dimension: "Clamp and rounding adjustment",
      points: round1(finalScore - breakdownTotal),
      explanation: "Keep score within zero to ten.",
    });
  const passed =
    passesDocumentQualityScore(finalScore) &&
    readabilityScore > 0 &&
    profile.name !== "Unclassified medical evidence" &&
    semantic.score >= 0.5 &&
    requiredMissing === 0;

  const reasonCodes = [
    passed ? "DOCUMENT_EVIDENCE_SUFFICIENT" : "DOCUMENT_EVIDENCE_INSUFFICIENT",
    ...missingFields.map(
      (field) => `MISSING_${field.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
    ),
    ...partialFields.map(
      (field) => `PARTIAL_${field.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
    ),
    ...contradictions.map((item) => item.code),
  ];
  const extractionSucceeded = extractions.some(
    (extraction) =>
      Boolean(extraction.rawText?.trim()) ||
      Object.values(extraction.fields).some((value) =>
        usableEvidenceValue(value),
      ),
  );
  if (readabilityScore === 0) reasonCodes.push("DOCUMENT_UNREADABLE");
  if (
    !extractionSucceeded &&
    extractions.some((extraction) =>
      extraction.warnings.some((warning) =>
        /(?:extraction|ocr|pdf text|parse|failed)/i.test(warning),
      ),
    )
  ) {
    reasonCodes.push("EXTRACTION_FAILURE");
  }
  if (semantic.score < 0.5) reasonCodes.push("SEMANTIC_MATCH_BELOW_THRESHOLD");
  if (requiredMissing > 0) reasonCodes.push("MISSING_REQUIRED_FIELDS");

  return {
    score: finalScore,
    validationStatus: passed ? "PASSED" : "FAILED",
    route: passed ? "CONTINUE_CHECKS" : "POOL_QUEUE",
    detectedMedicalProfile,
    completenessScore,
    consistencyScore,
    readabilityScore,
    semanticMatchScore,
    semanticEvidence,
    semanticPenalty,
    baseScore,
    evaluatorConfidence: confidence,
    reasonCodes,
    driverFactors: drivers,
    fieldEvaluations,
    completeFields,
    partialFields,
    missingFields,
    notApplicableFields,
    contradictions,
    matchedReferenceFields,
    extractedEvidence: Object.entries(fields)
      .filter(([, value]) => typeof value === "string" && value.trim())
      .slice(0, 14)
      .map(([key, value]) => `${key}: ${String(value).slice(0, 180)}`),
    matchedEvidence: profileEvidence,
    readabilityProblems,
    scoreBreakdown,
    engineUsed,
  };
}

export function passesDocumentQualityScore(score: number) {
  return Number.isFinite(score) && score >= INTAKE_POLICY.qualityMinimum;
}

function mergeClaimFields(all: ExtractedFields[]): ExtractedFields {
  const merged: ExtractedFields = {};
  for (const fields of all) {
    for (const [key, value] of Object.entries(fields) as [
      keyof ExtractedFields,
      unknown,
    ][]) {
      if (value !== undefined && value !== null && value !== "")
        merged[key] = value as never;
    }
  }
  return merged;
}

function inferProfile(text: string): {
  profile: ReferenceProfile;
  weightedScore: number;
  matchedEvidence: string[];
} {
  let best: ReferenceProfile | null = null;
  let bestScore = 0;
  let bestEvidence: string[] = [];
  for (const profile of PROFILES) {
    const matchedEvidence = profile.signals
      .filter((signal) => signal.pattern.test(text))
      .map((signal) => signal.label);
    const score = profile.signals.reduce(
      (count, signal) =>
        count + (signal.pattern.test(text) ? signal.weight : 0),
      0,
    );
    if (score > bestScore) {
      best = profile;
      bestScore = score;
      bestEvidence = matchedEvidence;
    }
  }
  if (!best || bestScore < 3) {
    return {
      profile: {
        name: "Unclassified medical evidence",
        signals: [],
        optional: new Set<keyof ExtractedFields>(),
      },
      weightedScore: bestScore,
      matchedEvidence: [],
    };
  }
  return {
    profile: best ?? {
      name: "Unclassified medical evidence",
      signals: [],
      optional: new Set<keyof ExtractedFields>(),
    },
    weightedScore: best ? Math.min(10, bestScore) : 3,
    matchedEvidence: bestEvidence,
  };
}

function calculateSemanticMatch(
  fields: ExtractedFields,
  profile: ReferenceProfile,
  matchedEvidence: string[],
) {
  if (profile.name === "Unclassified medical evidence")
    return {
      score: 0,
      evidence: [
        "No clinical reference profile matched the extracted content.",
      ],
    };
  const structuralFields = [
    fields.patientName || fields.policyNumber,
    fields.facilityName || fields.providerCode || fields.department,
    fields.serviceStart,
    fields.chiefComplaint || fields.symptoms,
    fields.treatment || fields.procedures,
    fields.diagnosis || fields.diagnosisCode,
    fields.investigations || fields.testResults,
    fields.supportingDocuments,
  ].filter(usableEvidenceValue).length;
  const signalScore = matchedEvidence.length / profile.signals.length;
  const structureScore = structuralFields / 8;
  return {
    score: Math.min(
      matchedEvidence.length < 2 ? 0.49 : 1,
      Math.round((0.6 * signalScore + 0.4 * structureScore) * 100) / 100,
    ),
    evidence: [
      ...matchedEvidence.map((item) => `Profile signal: ${item}`),
      `Matched ${structuralFields}/8 expected clinical evidence groups.`,
    ],
  };
}

function partialReason(label: string, fields: ExtractedFields) {
  if (label === "Patient and policy information")
    return "Patient or policy identity is present, but one or more identifiers are missing.";
  if (label === "Provider and facility information") {
    return [
      fields.facilityName
        ? "facility name is present"
        : "facility name is missing",
      fields.providerCode
        ? "provider code is present"
        : "provider code is missing",
      fields.department
        ? "department or specialty is present"
        : "department or specialty is missing",
    ].join("; ");
  }
  if (label === "Date and service timeline")
    return "A service date is present, but the complete service period is incomplete or ambiguous.";
  if (label === "Presenting symptoms")
    return "Symptoms are present but lack a complete chief complaint, duration, severity, or clinical context.";
  if (label === "Clinical examination and findings")
    return "Some examination or vital-sign evidence is present, but the clinical findings are incomplete.";
  if (label === "Investigations and results")
    return "Investigations or results are present, but the corresponding test/result pair is incomplete.";
  if (label === "Treatment, medication, or procedure details")
    return "Treatment or a procedure is mentioned, but the complete treatment/procedure details are missing.";
  if (label === "Diagnosis and medical coding")
    return "A diagnosis or assessment is present, but no reliable diagnosis/code pair is available.";
  if (label === "Supporting documents and billing consistency")
    return "Supporting documents or billing information is present, but the complete billing evidence is unavailable or implausible.";
  return "Some relevant evidence is present, but the dimension is incomplete.";
}

function billingIsPlausible(fields: ExtractedFields) {
  if (typeof fields.billingAmount !== "number" || fields.billingAmount < 0)
    return false;
  if (
    typeof fields.eligibleAmount === "number" &&
    (fields.eligibleAmount < 0 || fields.eligibleAmount > fields.billingAmount)
  )
    return false;
  if (
    typeof fields.patientResponsibility === "number" &&
    (fields.patientResponsibility < 0 ||
      fields.patientResponsibility > fields.billingAmount)
  )
    return false;
  return true;
}

function addConsistencyChecks(
  fields: ExtractedFields,
  contradictions: Contradiction[],
) {
  const start = fields.serviceStart ? Date.parse(fields.serviceStart) : NaN;
  const end = fields.serviceEnd ? Date.parse(fields.serviceEnd) : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end < start) {
    contradictions.push({
      code: "RELEASE_BEFORE_ADMISSION",
      message: "Release date precedes admission or arrival date.",
      penalty: 2,
      sourceFields: ["serviceStart", "serviceEnd"],
    });
  }
  const procedure = fields.procedureDate
    ? Date.parse(fields.procedureDate)
    : NaN;
  // A same-day visit/root-canal record commonly has one visit date and no separate procedure
  // date. Only compare an explicitly extracted procedureDate, and allow it on the visit day.
  const sameCalendarDay = (left: number, right: number) =>
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    new Date(left).toISOString().slice(0, 10) ===
      new Date(right).toISOString().slice(0, 10);
  const outsidePeriod =
    Number.isFinite(procedure) &&
    Number.isFinite(start) &&
    (Number.isFinite(end)
      ? !sameCalendarDay(procedure, start) &&
        !sameCalendarDay(procedure, end) &&
        (procedure < start || procedure > end)
      : !sameCalendarDay(procedure, start));
  if (outsidePeriod) {
    contradictions.push({
      code: "PROCEDURE_OUTSIDE_SERVICE_PERIOD",
      message: "Procedure date falls outside the service period.",
      penalty: 1,
      sourceFields: ["procedureDate", "serviceStart", "serviceEnd"],
    });
  }
  const dob = fields.dateOfBirth ? Date.parse(fields.dateOfBirth) : NaN;
  if (Number.isFinite(start) && Number.isFinite(dob) && dob > start) {
    contradictions.push({
      code: "IMPOSSIBLE_DATE_SEQUENCE",
      message: "Patient date of birth occurs after the service date.",
      penalty: 1,
      sourceFields: ["dateOfBirth", "serviceStart"],
    });
  }
  if (
    typeof fields.eligibleAmount === "number" &&
    typeof fields.billingAmount === "number" &&
    fields.eligibleAmount > fields.billingAmount
  ) {
    contradictions.push({
      code: "ELIGIBLE_AMOUNT_EXCEEDS_BILLED_AMOUNT",
      message: "Eligible amount exceeds billed amount.",
      penalty: 1,
      sourceFields: ["eligibleAmount", "billingAmount"],
    });
  }
  if (
    typeof fields.insurerPayment === "number" &&
    typeof fields.eligibleAmount === "number" &&
    fields.insurerPayment > fields.eligibleAmount
  ) {
    contradictions.push({
      code: "INSURER_PAYMENT_EXCEEDS_ELIGIBLE_AMOUNT",
      message: "Insurer payment exceeds the eligible amount.",
      penalty: 1,
      sourceFields: ["insurerPayment", "eligibleAmount"],
    });
  }
  if (
    typeof fields.patientResponsibility === "number" &&
    fields.patientResponsibility < 0
  ) {
    contradictions.push({
      code: "NEGATIVE_PATIENT_RESPONSIBILITY",
      message: "Patient responsibility is negative.",
      penalty: 1,
      sourceFields: ["patientResponsibility"],
    });
  }
  if (
    /K04\.0/i.test(fields.diagnosisCode ?? "") &&
    /apical periodontitis/i.test(fields.diagnosis ?? "")
  ) {
    contradictions.push({
      code: "ICD_CODE_REVIEW_REQUIRED",
      message:
        "Diagnosis mentions apical periodontitis, but K04.0 is a pulpitis code; verify the additional periapical diagnosis code.",
      penalty: 0,
      sourceFields: ["diagnosis", "diagnosisCode"],
    });
  }
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
