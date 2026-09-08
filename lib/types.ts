export type CaseStatus = "PENDING" | "ASSIGNED_STP" | "ASSIGNED_MANUAL" | "POOL_QUEUE" | "RESOLVED";
export type ComplexityBand = "low" | "medium" | "high";
export type DecisionPath = "STP" | "MANUAL" | "ESCALATED" | "POOL_QUEUE";
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
  /** Final case complexity score after the application/clinical weighted blend. */
  caseComplexityScore: number;
  band: ComplexityBand;
  reasonCode: string;
  driverFactors: string[];
  applicationComplexityScore: number;
  clinicalComplexityScore: number;
  complexityConfidence: number;
  complexityEvidence: string[];
};

export type SpecializationEntity = { text: string; specialization: string };

export type NERResult = {
  entities: SpecializationEntity[];
  specialtiesRequired: string[];
  possibleSpecialties?: string[];
  confidence: number;
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
export type DocumentKind = "medical" | "financial" | "identity" | "application" | "claim" | "other";
export type EvidenceSource = "ocr" | "pdf-text-extraction" | "docx-extraction" | "plain-text" | "gemini" | "user-edited";
export type DocumentSession = {
  documentSessionId: string;
  sourceFileName: string;
  sourceFileHash?: string;
  createdAt: string;
};
export type PoolQueueReason =
  | "DOCUMENT_QUALITY_FAILURE"
  | "INSUFFICIENT_EVALUATION_CONFIDENCE"
  | "POLICY_FAILURE"
  | "NO_ELIGIBLE_UNDERWRITER"
  | "COMPLEXITY_REQUIRES_MANUAL_REVIEW"
  | "DOCUMENT_UNREADABLE"
  | "EXTRACTION_FAILURE"
  | "CONTRADICTORY_INFORMATION"
  | "SEMANTIC_MATCH_BELOW_THRESHOLD";

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
  // Claim / hospital-record fields. These are intentionally separate from the
  // underwriting application fields above: a claim dossier may contain rich
  // clinical and billing evidence without changing the application itself.
  patientName?: string;
  dateOfBirth?: string;
  medicalRecordNumber?: string;
  policyNumber?: string;
  providerCode?: string;
  facilityName?: string;
  department?: string;
  roomOrServiceLocation?: string;
  serviceStart?: string;
  serviceEnd?: string;
  chiefComplaint?: string;
  symptoms?: string;
  relevantMedicalHistory?: string;
  vitalSigns?: string;
  physicalFindings?: string;
  investigations?: string;
  testResults?: string;
  treatment?: string;
  procedures?: string;
  procedureDate?: string;
  clinicalCourse?: string;
  outcome?: string;
  dischargeInstructions?: string;
  diagnosis?: string;
  diagnosisCode?: string;
  supportingDocuments?: string;
  billingAmount?: number;
  eligibleAmount?: number;
  patientResponsibility?: number;
  insurerPayment?: number;
  extractionConfidence?: number;
  extractionSource?: EvidenceSource;
};

export type DocumentExtraction = {
  fileName: string;
  mimeType: string;
  kind: DocumentKind;
  provider: "gemini" | "stub";
  fields: ExtractedFields;
  rawText?: string;
  readable?: boolean;
  source?: EvidenceSource;
  summary: string;
  warnings: string[];
  documentSessionId?: string;
  sourceFileHash?: string;
  createdAt?: string;
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
  documentSessionId?: string;
};

export type DocumentValidationStatus = "PASSED" | "FAILED";
export type DocumentRoute = "AUTO_ASSIGN" | "POOL_QUEUE";
export type FieldStatus = "COMPLETE" | "PARTIAL" | "MISSING" | "NOT_APPLICABLE";
export type ContradictionReasonCode =
  | "RELEASE_BEFORE_ADMISSION"
  | "PROCEDURE_OUTSIDE_SERVICE_PERIOD"
  | "ELIGIBLE_AMOUNT_EXCEEDS_BILLED_AMOUNT"
  | "INSURER_PAYMENT_EXCEEDS_ELIGIBLE_AMOUNT"
  | "NEGATIVE_PATIENT_RESPONSIBILITY"
  | "IMPOSSIBLE_DATE_SEQUENCE"
  | "ICD_CODE_REVIEW_REQUIRED";
export type FieldEvaluation = {
  field: string;
  label: string;
  status: FieldStatus;
  points: number;
  reason: string;
};
export type Contradiction = {
  code: ContradictionReasonCode;
  message: string;
  penalty: number;
  sourceFields: string[];
};

export type DocumentQualityEvaluation = {
  score: number;
  validationStatus: DocumentValidationStatus;
  route: DocumentRoute;
  detectedMedicalProfile: string;
  completenessScore: number;
  consistencyScore: number;
  readabilityScore: number;
  semanticMatchScore: number;
  semanticEvidence: string[];
  semanticPenalty: number;
  baseScore: number;
  evaluatorConfidence: number;
  reasonCodes: string[];
  driverFactors: Array<{
    factor: string;
    impact: "positive" | "negative" | "neutral";
    points?: number;
    explanation: string;
  }>;
  fieldEvaluations: FieldEvaluation[];
  completeFields: string[];
  partialFields: string[];
  missingFields: string[];
  notApplicableFields: string[];
  contradictions: Contradiction[];
  matchedReferenceFields: string[];
  extractedEvidence: string[];
  matchedEvidence: string[];
  readabilityProblems: string[];
  scoreBreakdown: Array<{ dimension: string; points: number; explanation: string }>;
  engineUsed: "gemini" | "deterministic-fallback";
};

export type UnderwritingCase = ApplicationInput & {
  id: string;
  status: CaseStatus;
  decisionPath: DecisionPath | null;
  missingFields: string[];
  followUpMessage: string;
  complexity: ComplexityResult | null;
  poolQueueReason: PoolQueueReason | null;
  ner: NERResult | null;
  match: MatchResult | null;
  assigneeId: string | null;
  provider: "gemini" | "fallback" | null;
  documentExtractions: DocumentExtraction[];
  ingestion: IngestionResult | null;
  documentQuality: DocumentQualityEvaluation | null;
  documentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  audit: AuditEvent[];
};

export type RerouteRequest = { reason: string; excludeUnderwriterId?: string };
export type OverrideDecision = { underwriterId: string; note: string };
