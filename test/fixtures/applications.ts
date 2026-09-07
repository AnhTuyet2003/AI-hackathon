import type {
  ApplicationInput,
  CaseStatus,
  ComplexityBand,
  DecisionPath,
  DocumentExtraction,
  IngestionResult
} from "@/lib/types";

// Canonical fixture set for the whole project. One place that both:
//   - the running app reads (lib/seed.ts builds the initial dashboard from `applicationFixtures`
//     + `generateApplications`; the Submit form's demo buttons use `submitPresets`), and
//   - test/verify.mjs replays through the intake pipeline and asserts each `expected` outcome.
//
// The curated list has at least one request for every branch the pipeline can take -- each
// CaseStatus, each DecisionPath, each complexity band, each specialization the NER extractor
// knows, incomplete-application follow-ups, and every product line -- with realistic values
// (diacritic-correct Vietnamese names, medical notes that actually trip the rule-based
// classifier). The generator then adds deterministic background volume.
//
// Document files referenced by `documents` live in test/fixtures/documents/ (run
// `node test/make-documents.mjs` to (re)generate them).

export type FixtureGroup = "STP" | "Manual" | "Escalated" | "Incomplete" | "Resolved";

// What the deterministic engine (lib/mock-ai.ts + lib/matching.ts) is expected to produce.
// Coarse on purpose -- the exact assignee depends on live queue loads, so we assert
// tier/specialty intent, not a specific underwriter name.
export type ExpectedOutcome = {
  band: ComplexityBand;
  decisionPath: DecisionPath;
  status: CaseStatus;
  specialties: string[];
  missingFields?: string[];
  note?: string;
};

export type ApplicationFixture = {
  key: string;
  label: string;
  group: FixtureGroup;
  input: ApplicationInput;
  // Minutes before "now" this case was submitted -- lets the seed spread the demo timeline
  // across ~30 days instead of the last hour.
  minutesAgo: number;
  // Resolved group only: the human note on the closing audit event.
  resolveNote?: string;
  expected: ExpectedOutcome;
};

const DOCS_BASIC = ["application-form.pdf", "id-verification.pdf"];
const DOCS_MEDICAL = ["application-form.pdf", "medical-questionnaire.pdf", "doctor-notes.pdf"];
const DOCS_FULL = ["application-form.pdf", "medical-questionnaire.pdf", "doctor-notes.pdf", "financial-statement.pdf"];

export const applicationFixtures: ApplicationFixture[] = [
  // ----------------------------------------------------------------------------------------------
  // STP -- clean, low-complexity, auto-assigned with no human review.
  // ----------------------------------------------------------------------------------------------
  {
    key: "stp-junior-clean-life",
    label: "STP - clean Individual Life",
    group: "STP",
    minutesAgo: 35,
    input: {
      applicantName: "Nguyễn Văn An",
      age: 29,
      sumAssured: 80_000,
      occupation: "Software Engineer",
      productLine: "Individual Life",
      medicalHistory: "No significant medical history. Non-smoker, regular annual checkups.",
      disclosures: "No prior claims or declined applications.",
      documents: DOCS_BASIC
    },
    expected: { band: "low", decisionPath: "STP", status: "ASSIGNED_STP", specialties: [] }
  },
  {
    key: "stp-teacher-group",
    label: "STP - Group Life, teacher",
    group: "STP",
    minutesAgo: 220,
    input: {
      applicantName: "Lê Thị Hồng",
      age: 35,
      sumAssured: 120_000,
      occupation: "Secondary School Teacher",
      productLine: "Group Life",
      medicalHistory: "No chronic conditions. Non-smoker, BMI within normal range.",
      disclosures: "No prior claims.",
      documents: DOCS_BASIC
    },
    expected: { band: "low", decisionPath: "STP", status: "ASSIGNED_STP", specialties: [] }
  },
  {
    key: "stp-health-minor",
    label: "STP - Health, minor condition",
    group: "STP",
    minutesAgo: 900,
    input: {
      applicantName: "Trần Quốc Bảo",
      age: 41,
      sumAssured: 90_000,
      occupation: "Graphic Designer",
      productLine: "Health",
      medicalHistory: "Seasonal allergic rhinitis, otherwise healthy. Non-smoker.",
      disclosures: "None.",
      documents: DOCS_BASIC
    },
    expected: { band: "low", decisionPath: "STP", status: "ASSIGNED_STP", specialties: [] }
  },
  {
    key: "stp-ci-young",
    label: "STP - Critical Illness, young applicant",
    group: "STP",
    minutesAgo: 1_600,
    input: {
      applicantName: "Phạm Thị Lan",
      age: 27,
      sumAssured: 60_000,
      occupation: "Marketing Specialist",
      productLine: "Critical Illness",
      medicalHistory: "No significant medical history. Non-smoker.",
      disclosures: "No prior claims.",
      documents: DOCS_BASIC
    },
    expected: { band: "low", decisionPath: "STP", status: "ASSIGNED_STP", specialties: [] }
  },
  {
    key: "stp-accountant-midage",
    label: "STP - accountant, mid-forties",
    group: "STP",
    minutesAgo: 3_100,
    input: {
      applicantName: "Đỗ Văn Cường",
      age: 44,
      sumAssured: 140_000,
      occupation: "Accountant",
      productLine: "Individual Life",
      medicalHistory: "Mild seasonal allergies. Non-smoker, exercises regularly.",
      disclosures: "No prior claims or declined applications.",
      documents: DOCS_BASIC
    },
    expected: { band: "low", decisionPath: "STP", status: "ASSIGNED_STP", specialties: [] }
  },

  // ----------------------------------------------------------------------------------------------
  // Manual -- medium/high complexity but a qualified underwriter is available.
  // ----------------------------------------------------------------------------------------------
  {
    key: "manual-endocrinology-senior",
    label: "Manual - Endocrinology match",
    group: "Manual",
    minutesAgo: 55,
    input: {
      applicantName: "Đỗ Minh Châu",
      age: 49,
      sumAssured: 420_000,
      occupation: "Bank Manager",
      productLine: "Individual Life",
      medicalHistory: "History of Type 2 Diabetes managed with medication for 5 years. HbA1c stable at last review.",
      disclosures: "Ongoing endocrinology follow-up disclosed; no hospitalisation.",
      documents: DOCS_MEDICAL
    },
    expected: { band: "medium", decisionPath: "MANUAL", status: "ASSIGNED_MANUAL", specialties: ["Endocrinology"] }
  },
  {
    key: "manual-cardiology-senior",
    label: "Manual - Cardiology match",
    group: "Manual",
    minutesAgo: 140,
    input: {
      applicantName: "Trần Thị Bích",
      age: 53,
      sumAssured: 300_000,
      occupation: "Restaurant Owner",
      productLine: "Individual Life",
      medicalHistory: "Controlled hypertension and one prior episode of Myocardial Infarction in 2023, managed with medication.",
      disclosures: "Cardiac medication use disclosed; no hospitalisation in the last 12 months.",
      documents: DOCS_MEDICAL
    },
    expected: { band: "medium", decisionPath: "MANUAL", status: "ASSIGNED_MANUAL", specialties: ["Cardiology"] }
  },
  {
    key: "manual-oncology-remission",
    label: "Manual - Oncology, in remission",
    group: "Manual",
    minutesAgo: 460,
    input: {
      applicantName: "Vũ Thị Mai",
      age: 57,
      sumAssured: 650_000,
      occupation: "Business Consultant",
      productLine: "Critical Illness",
      medicalHistory: "Breast cancer treated in 2019, currently in remission. Annual oncology screening clear.",
      disclosures: "Full oncology records provided.",
      documents: DOCS_FULL
    },
    expected: { band: "medium", decisionPath: "MANUAL", status: "ASSIGNED_MANUAL", specialties: ["Oncology"] }
  },
  {
    key: "manual-pilot-highrisk-clean",
    label: "Manual - high-risk occupation, clean medical",
    group: "Manual",
    minutesAgo: 780,
    input: {
      applicantName: "Nguyễn Hoàng Nam",
      age: 39,
      sumAssured: 250_000,
      occupation: "Commercial Pilot",
      productLine: "Individual Life",
      medicalHistory: "No significant medical history. Passes annual aviation medical without restriction.",
      disclosures: "No prior claims.",
      documents: DOCS_BASIC
    },
    expected: { band: "medium", decisionPath: "MANUAL", status: "ASSIGNED_MANUAL", specialties: [], note: "Escalated risk driven by occupation, not health." }
  },
  {
    key: "manual-age-endocrine",
    label: "Manual - older applicant, Endocrinology",
    group: "Manual",
    minutesAgo: 1_250,
    input: {
      applicantName: "Lý Thị Hoa",
      age: 62,
      sumAssured: 180_000,
      occupation: "Retired Civil Servant",
      productLine: "Health",
      medicalHistory: "Type 2 Diabetes diagnosed at age 58, diet-controlled. Age-related osteoarthritis, well managed.",
      disclosures: "No prior claims.",
      documents: DOCS_MEDICAL
    },
    expected: { band: "medium", decisionPath: "MANUAL", status: "ASSIGNED_MANUAL", specialties: ["Endocrinology"] }
  },
  {
    key: "manual-hypertension-mild",
    label: "Manual - newly diagnosed hypertension",
    group: "Manual",
    minutesAgo: 2_400,
    input: {
      applicantName: "Hoàng Văn Phúc",
      age: 47,
      sumAssured: 210_000,
      occupation: "Factory Supervisor",
      productLine: "Individual Life",
      medicalHistory: "Mild hypertension, recently diagnosed, lifestyle management advised.",
      disclosures: "No prior claims.",
      documents: DOCS_MEDICAL
    },
    expected: { band: "medium", decisionPath: "MANUAL", status: "ASSIGNED_MANUAL", specialties: ["Cardiology"] }
  },
  {
    key: "manual-endocrine-group",
    label: "Manual - Group Life, insulin-dependent",
    group: "Manual",
    minutesAgo: 5_200,
    input: {
      applicantName: "Đặng Thị Thu",
      age: 51,
      sumAssured: 480_000,
      occupation: "HR Director",
      productLine: "Group Life",
      medicalHistory: "Type 2 Diabetes, insulin-dependent, HbA1c 7.8 at last review.",
      disclosures: "Endocrinology notes attached.",
      documents: DOCS_MEDICAL
    },
    expected: { band: "medium", decisionPath: "MANUAL", status: "ASSIGNED_MANUAL", specialties: ["Endocrinology"] }
  },
  {
    key: "manual-renal-medical",
    label: "Manual - renal disease, Medical tier",
    group: "Manual",
    minutesAgo: 8_600,
    input: {
      applicantName: "Trịnh Văn Hùng",
      age: 59,
      sumAssured: 900_000,
      occupation: "Warehouse Owner",
      productLine: "Critical Illness",
      medicalHistory: "Chronic kidney disease on regular dialysis; awaiting transplant assessment.",
      disclosures: "Nephrology and transplant unit records provided.",
      documents: DOCS_FULL
    },
    expected: { band: "medium", decisionPath: "MANUAL", status: "ASSIGNED_MANUAL", specialties: ["Complex Medical"], note: "Reaches the Medical tier via Dr. Do Khanh." }
  },
  {
    key: "manual-multimorbidity-assignable",
    label: "Manual - multi-morbidity, still assignable",
    group: "Manual",
    minutesAgo: 12_000,
    input: {
      applicantName: "Bùi Văn Tài",
      age: 55,
      sumAssured: 700_000,
      occupation: "Logistics Manager",
      productLine: "Individual Life",
      medicalHistory: "Type 2 Diabetes with early kidney involvement; controlled hypertension.",
      disclosures: "Full specialist records provided; nephrology and endocrinology follow-up ongoing.",
      documents: DOCS_FULL
    },
    expected: { band: "high", decisionPath: "MANUAL", status: "ASSIGNED_MANUAL", specialties: ["Endocrinology", "Cardiology", "Complex Medical"] }
  },

  // ----------------------------------------------------------------------------------------------
  // Escalated -- no underwriter clears every gating policy, routed to the Pool Queue.
  // ----------------------------------------------------------------------------------------------
  {
    key: "escalate-multimorbidity-hnw",
    label: "Escalated - HNW multi-morbidity",
    group: "Escalated",
    minutesAgo: 30,
    input: {
      applicantName: "Lê Hoàng Minh",
      age: 63,
      sumAssured: 1_800_000,
      occupation: "Offshore Drilling Supervisor",
      productLine: "Individual Life",
      medicalHistory:
        "Complex multi-morbidity profile: Type 2 Diabetes with recurring complications, history of Myocardial Infarction, and early-stage cirrhosis.",
      disclosures: "High-net-worth applicant seeking HNW financial profiling review alongside medical underwriting.",
      documents: DOCS_FULL
    },
    expected: { band: "high", decisionPath: "ESCALATED", status: "POOL_QUEUE", specialties: ["Endocrinology", "Cardiology", "Complex Medical"] }
  },
  {
    key: "escalate-authority-cap",
    label: "Escalated - Sum Assured over all authority limits",
    group: "Escalated",
    minutesAgo: 320,
    input: {
      applicantName: "Ngô Thị Kim",
      age: 44,
      sumAssured: 3_000_000,
      occupation: "Company Founder",
      productLine: "Individual Life",
      medicalHistory: "Well-controlled hypertension, otherwise healthy. Non-smoker.",
      disclosures: "Ultra-high-net-worth; independent medical exam completed, all clear.",
      documents: DOCS_FULL
    },
    expected: { band: "medium", decisionPath: "ESCALATED", status: "POOL_QUEUE", specialties: ["Cardiology"], note: "Purely an authority-limit escalation -- health is clean." }
  },
  {
    key: "escalate-catastrophic-sa",
    label: "Escalated - catastrophic Sum Assured, dual specialty",
    group: "Escalated",
    minutesAgo: 6_400,
    input: {
      applicantName: "Đoàn Văn Sơn",
      age: 61,
      sumAssured: 5_000_000,
      occupation: "Real Estate Developer",
      productLine: "Individual Life",
      medicalHistory: "Prior Myocardial Infarction and Type 2 Diabetes; ongoing cardiology and endocrinology care.",
      disclosures: "UHNW; comprehensive medical and financial dossier submitted.",
      documents: DOCS_FULL
    },
    expected: { band: "high", decisionPath: "ESCALATED", status: "POOL_QUEUE", specialties: ["Cardiology", "Endocrinology"] }
  },

  // ----------------------------------------------------------------------------------------------
  // Incomplete -- pipeline still runs and routes, but the Completeness check flags follow-ups.
  // ----------------------------------------------------------------------------------------------
  {
    key: "incomplete-missing-disclosures",
    label: "Incomplete - missing financial disclosures",
    group: "Incomplete",
    minutesAgo: 90,
    input: {
      applicantName: "Cao Thị Yến",
      age: 45,
      sumAssured: 350_000,
      occupation: "Interior Designer",
      productLine: "Individual Life",
      medicalHistory: "No significant medical history.",
      disclosures: "",
      documents: ["application-form.pdf"]
    },
    expected: {
      band: "low",
      decisionPath: "STP",
      status: "ASSIGNED_STP",
      specialties: [],
      missingFields: ["financial disclosures"]
    }
  },
  {
    key: "incomplete-missing-history-and-docs",
    label: "Incomplete - no medical history, no documents",
    group: "Incomplete",
    minutesAgo: 600,
    input: {
      applicantName: "Tô Văn Lâm",
      age: 38,
      sumAssured: 130_000,
      occupation: "Sales Executive",
      productLine: "Health",
      medicalHistory: "",
      disclosures: "No prior claims.",
      documents: []
    },
    expected: {
      band: "low",
      decisionPath: "STP",
      status: "ASSIGNED_STP",
      specialties: [],
      missingFields: ["medical history / doctor notes", "supporting documents"]
    }
  },
  {
    key: "incomplete-blank-occupation",
    label: "Incomplete - occupation not provided",
    group: "Incomplete",
    minutesAgo: 4_300,
    input: {
      applicantName: "Hà Thị Diệu",
      age: 50,
      sumAssured: 240_000,
      occupation: "",
      productLine: "Individual Life",
      medicalHistory: "Controlled hypertension.",
      disclosures: "Records provided.",
      documents: ["application-form.pdf", "medical-questionnaire.pdf"]
    },
    expected: {
      band: "medium",
      decisionPath: "MANUAL",
      status: "ASSIGNED_MANUAL",
      specialties: ["Cardiology"],
      missingFields: ["occupation"]
    }
  },

  // ----------------------------------------------------------------------------------------------
  // Resolved -- older cases an underwriter has already closed. Populates "closed" dashboard metrics.
  // ----------------------------------------------------------------------------------------------
  {
    key: "resolved-stp-clean",
    label: "Resolved - STP case, closed",
    group: "Resolved",
    minutesAgo: 17_280, // ~12 days
    resolveNote: "Underwriter confirmed auto-assignment; policy issued at standard rates.",
    input: {
      applicantName: "Trương Văn Đạt",
      age: 33,
      sumAssured: 95_000,
      occupation: "Civil Engineer",
      productLine: "Individual Life",
      medicalHistory: "No significant medical history. Non-smoker.",
      disclosures: "No prior claims.",
      documents: DOCS_BASIC
    },
    expected: { band: "low", decisionPath: "STP", status: "RESOLVED", specialties: [] }
  },
  {
    key: "resolved-manual-cardiology",
    label: "Resolved - manual Cardiology case, closed",
    group: "Resolved",
    minutesAgo: 28_800, // ~20 days
    resolveNote: "Cardiology review complete; offered with a rated premium loading.",
    input: {
      applicantName: "Mai Thị Phượng",
      age: 54,
      sumAssured: 380_000,
      occupation: "School Principal",
      productLine: "Individual Life",
      medicalHistory: "Controlled hypertension; prior coronary stent placement, stable since.",
      disclosures: "Cardiology clearance letter provided.",
      documents: DOCS_MEDICAL
    },
    expected: { band: "medium", decisionPath: "MANUAL", status: "RESOLVED", specialties: ["Cardiology"] }
  },
  {
    key: "resolved-medical-endocrine",
    label: "Resolved - Medical tier Endocrinology case, closed",
    group: "Resolved",
    minutesAgo: 11_520, // ~8 days
    resolveNote: "Medical underwriter finalised terms; exclusion applied for diabetic complications.",
    input: {
      applicantName: "Nguyễn Thị Quỳnh",
      age: 60,
      sumAssured: 610_000,
      occupation: "Clinic Owner",
      productLine: "Critical Illness",
      medicalHistory: "Type 2 Diabetes with retinopathy; HbA1c improving on current regimen.",
      disclosures: "Endocrinology and ophthalmology records provided.",
      documents: DOCS_FULL
    },
    expected: { band: "medium", decisionPath: "MANUAL", status: "RESOLVED", specialties: ["Endocrinology"] }
  }
];

// ------------------------------------------------------------------------------------------------
// Deterministic generator -- background volume for the dashboard without hand-writing every case.
// Same seed => same applications on every machine and every reload.
// ------------------------------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  "Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý"
];
const MIDDLE_NAMES = ["Văn", "Thị", "Hoàng", "Minh", "Thanh", "Quốc", "Thu", "Ngọc", "Gia", "Anh"];
const LAST_NAMES = [
  "An", "Bình", "Cường", "Dũng", "Giang", "Hà", "Hải", "Hạnh", "Hùng", "Khánh", "Lan", "Linh",
  "Long", "Mai", "Nam", "Nga", "Phúc", "Quân", "Sơn", "Tâm", "Thảo", "Trang", "Tuấn", "Vy"
];

const STANDARD_OCCUPATIONS = [
  "Software Engineer", "Accountant", "Secondary School Teacher", "Marketing Specialist", "Bank Teller",
  "Civil Engineer", "Nurse", "Retail Manager", "Graphic Designer", "Logistics Coordinator", "HR Officer", "Pharmacist"
];
const HIGH_RISK_OCCUPATIONS = [
  "Offshore Drilling Technician", "Underground Mining Engineer", "Commercial Pilot", "Deep Sea Diver", "Demolition Foreman", "Firefighter"
];

type MedicalProfile = { medicalHistory: string; disclosures: string; documents: string[] };

const CLEAN_PROFILES: MedicalProfile[] = [
  { medicalHistory: "No significant medical history. Non-smoker.", disclosures: "No prior claims.", documents: DOCS_BASIC },
  {
    medicalHistory: "Occasional tension headaches, no medication. BMI within normal range.",
    disclosures: "No prior claims or declined applications.",
    documents: DOCS_BASIC
  },
  {
    medicalHistory: "Appendectomy in 2016, full recovery, no complications since.",
    disclosures: "No prior claims.",
    documents: DOCS_BASIC
  }
];

const SPECIALTY_PROFILES: MedicalProfile[] = [
  {
    medicalHistory: "Type 2 Diabetes, managed with oral medication for 4 years. HbA1c stable.",
    disclosures: "Endocrinology follow-up ongoing.",
    documents: DOCS_MEDICAL
  },
  {
    medicalHistory: "Controlled hypertension; one prior cardiac event managed with medication.",
    disclosures: "Cardiology review letter provided.",
    documents: DOCS_MEDICAL
  },
  {
    medicalHistory: "Thyroid carcinoma treated in 2018, in remission, annual oncology screening clear.",
    disclosures: "Oncology records provided.",
    documents: DOCS_MEDICAL
  },
  {
    medicalHistory: "Chronic liver condition (early fibrosis) under hepatology monitoring.",
    disclosures: "Hepatology records provided.",
    documents: DOCS_FULL
  }
];

const PRODUCT_LINES = ["Individual Life", "Group Life", "Critical Illness", "Health"];

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Deterministically build `count` synthetic applications. Roughly 68% clean, 22% single-specialty,
 * 10% high-risk-occupation, which keeps the STP / Manual / Escalated split believable without every
 * generated case looking the same.
 */
export function generateApplications(count: number, seed = 1337): ApplicationInput[] {
  const rng = mulberry32(seed);
  const out: ApplicationInput[] = [];

  for (let i = 0; i < count; i += 1) {
    const roll = rng();
    const highRisk = roll > 0.9;
    const specialty = !highRisk && roll > 0.68;

    const profile = specialty ? pick(rng, SPECIALTY_PROFILES) : pick(rng, CLEAN_PROFILES);
    const occupation = highRisk ? pick(rng, HIGH_RISK_OCCUPATIONS) : pick(rng, STANDARD_OCCUPATIONS);
    const age = 24 + Math.floor(rng() * 40); // 24..63
    const sumAssured =
      specialty || highRisk
        ? (2 + Math.floor(rng() * 18)) * 25_000 // 50k..475k
        : (1 + Math.floor(rng() * 5)) * 25_000; // 25k..125k

    out.push({
      applicantName: `${pick(rng, FIRST_NAMES)} ${pick(rng, MIDDLE_NAMES)} ${pick(rng, LAST_NAMES)}`,
      age,
      sumAssured,
      occupation,
      productLine: pick(rng, PRODUCT_LINES),
      medicalHistory: profile.medicalHistory,
      disclosures: profile.disclosures,
      documents: profile.documents
    });
  }

  return out;
}

// ------------------------------------------------------------------------------------------------
// Demo document extractions for a couple of seed cases, so the Case Detail "Data Ingestion Engine"
// panel has content without a live upload. Plain literals (no @google/genai import) -- safe for the
// client bundle that pulls in lib/seed.ts.
// ------------------------------------------------------------------------------------------------
export const demoIngestionByKey: Record<string, { extractions: DocumentExtraction[]; ingestion: IngestionResult }> = {
  "manual-cardiology-senior": {
    extractions: [
      {
        fileName: "doctor-notes.pdf",
        mimeType: "application/pdf",
        kind: "medical",
        provider: "gemini",
        fields: {
          smoker: false,
          bmi: 28,
          medicalConditions: ["Controlled hypertension", "Myocardial Infarction (2023)"],
          medications: ["Bisoprolol", "Atorvastatin"],
          medicalSummary: "Cardiology follow-up letter: stable post-MI, adherent to medication, no angina."
        },
        summary: "doctor-notes.pdf: non-smoker | Controlled hypertension, Myocardial Infarction (2023) | 2 medication(s).",
        warnings: []
      }
    ],
    ingestion: { extractions: [], filledFields: [], overriddenFields: [], appendedToMedicalHistory: true, mode: "auto", reconciliation: null }
  },
  "manual-endocrine-group": {
    extractions: [
      {
        fileName: "financial-statement.pdf",
        mimeType: "application/pdf",
        kind: "financial",
        provider: "gemini",
        fields: {
          annualIncome: 145_000,
          sumAssured: 480_000,
          disclosuresText: "Audited financials support the requested cover; debt-to-income within guidelines."
        },
        summary: "financial-statement.pdf: income 145,000 | sum assured 480,000.",
        warnings: []
      },
      {
        fileName: "medical-questionnaire.pdf",
        mimeType: "application/pdf",
        kind: "medical",
        provider: "stub",
        fields: { smoker: false, medicalConditions: ["Type 2 Diabetes (insulin-dependent)"] },
        summary: "medical-questionnaire.pdf: non-smoker | Type 2 Diabetes (insulin-dependent).",
        warnings: ["Offline stub used (GEMINI_API_KEY is not configured.). Fields inferred from the file name, not parsed from content."]
      }
    ],
    ingestion: {
      extractions: [],
      filledFields: [],
      overriddenFields: [{ field: "sumAssured", from: "450000", to: "480000", source: "financial-statement.pdf" }],
      appendedToMedicalHistory: true,
      mode: "auto",
      reconciliation: null
    }
  }
};

for (const entry of Object.values(demoIngestionByKey)) {
  entry.ingestion.extractions = entry.extractions;
}

// Curated subset surfaced as one-click presets on the Submit form. One per pipeline branch.
export const submitPresets: { label: string; input: ApplicationInput }[] = [
  "stp-junior-clean-life",
  "manual-cardiology-senior",
  "manual-renal-medical",
  "escalate-multimorbidity-hnw",
  "incomplete-missing-disclosures"
].map((key) => {
  const fixture = applicationFixtures.find((f) => f.key === key);
  if (!fixture) throw new Error(`submitPresets references unknown fixture key: ${key}`);
  return { label: fixture.label, input: fixture.input };
});
