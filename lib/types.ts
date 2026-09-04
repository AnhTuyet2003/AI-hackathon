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
  createdAt: string;
  updatedAt: string;
  audit: AuditEvent[];
};

export type RerouteRequest = { reason: string; excludeUnderwriterId?: string };
export type OverrideDecision = { underwriterId: string; note: string };
