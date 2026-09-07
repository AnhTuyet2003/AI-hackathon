export type CaseStatus = "PENDING" | "ASSIGNED_STP" | "ASSIGNED_MANUAL" | "POOL_QUEUE" | "RESOLVED";
export type ComplexityBand = "low" | "medium" | "high";
export type DecisionPath = "STP" | "MANUAL" | "ESCALATED";
export type AvailabilityStatus = "active" | "dnd" | "offline";
export type UnderwriterTier = "Junior" | "Senior" | "Medical";

export type ApplicationInput = {
  applicantName: string;
  age: number;
  sumAssured: number;
  occupation: string;
  productLine: string;
  medicalHistory: string;
  disclosures: string;
  documents: string[];
};

export type ComplexityResult = {
  score: number;
  band: ComplexityBand;
  reasonCode: string;
  driverFactors: string[];
};

export type SpecializationEntity = { text: string; specialization: string };

export type NERResult = {
  entities: SpecializationEntity[];
  specialtiesRequired: string[];
};

export type Underwriter = {
  id: string;
  name: string;
  tier: UnderwriterTier;
  authorityLimit: number | null;
  specializationTags: string[];
  currentQueueLoad: number;
  slaMinutesRemainingAvg: number;
  availability: AvailabilityStatus;
};

export type PolicyCheck = { policy: string; passed: boolean; detail: string };

export type UnderwriterEvaluation = {
  underwriterId: string;
  policies: PolicyCheck[];
  eligible: boolean;
  matchRank: number;
};

export type MatchResult = {
  chosenUnderwriterId: string | null;
  evaluations: UnderwriterEvaluation[];
  engine: "mcp-solver" | "greedy-fallback";
  rationale: string;
};

export type AuditEvent = {
  id: string;
  caseId: string;
  actor: "ai" | "human" | "system";
  action: string;
  detail: string;
  createdAt: string;
};

// ---------------------------------------------------------------------------------------------
// Document Ingestion Engine (build spec Sect. 3, step 2). Structured fields pulled out of an
// uploaded supporting document -- a subset of the ~26-field schema used by the PAX reference
// project's OpenAI-Vision extractor, mapped onto this app's ApplicationInput domain.
// ---------------------------------------------------------------------------------------------
export type DocumentKind = "medical" | "financial" | "identity" | "application" | "other";

export type ExtractedFields = {
  age?: number;
  sumAssured?: number;
  occupation?: string;
  productLine?: string;
  smoker?: boolean;
  packsPerWeek?: number;
  heightCm?: number;
  weightKg?: number;
  bmi?: number;
  annualIncome?: number;
  maritalStatus?: string;
  medicalConditions?: string[];
  medications?: string[];
  dangerousSports?: string[];
  disclosuresText?: string;
  medicalSummary?: string;
};

export type DocumentExtraction = {
  fileName: string;
  mimeType: string;
  kind: DocumentKind;
  provider: "gemini" | "stub";
  fields: ExtractedFields;
  summary: string;
  warnings: string[];
};

export type FieldOverride = { field: string; from: string; to: string; source: string };

// What the submitter decided when the interactive Submit page asked them to reconcile document
// data against what they typed (instead of the AI silently overriding).
export type ReconciliationLog = {
  applied: FieldOverride[]; // submitter chose the document value
  keptOwn: { field: string; userValue: string; documentValue: string; source: string }[]; // kept their own despite a mismatch
  addedToMedicalHistory: boolean;
  addedToDisclosures: boolean;
};

export type IngestionResult = {
  extractions: DocumentExtraction[];
  filledFields: string[];
  overriddenFields: FieldOverride[];
  appendedToMedicalHistory: boolean;
  // "auto"  -> legacy/direct-API path: document values merged automatically.
  // "reconciled" -> submitter reviewed each difference on the Submit page before intake.
  mode?: "auto" | "reconciled";
  reconciliation?: ReconciliationLog | null;
};

export type UnderwritingCase = ApplicationInput & {
  id: string;
  status: CaseStatus;
  decisionPath: DecisionPath | null;
  missingFields: string[];
  followUpMessage: string;
  complexity: ComplexityResult | null;
  ner: NERResult | null;
  match: MatchResult | null;
  assigneeId: string | null;
  provider: "gemini" | "fallback" | null;
  documentExtractions: DocumentExtraction[];
  ingestion: IngestionResult | null;
  createdAt: string;
  updatedAt: string;
  audit: AuditEvent[];
};

export type RerouteRequest = { reason: string; excludeUnderwriterId?: string };
export type OverrideDecision = { underwriterId: string; note: string };
