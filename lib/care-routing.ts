/** Treatment-submission evaluation policy. Separate from life underwriting. */
export const CARE_POLICY_VERSION = "care-routing-v1-draft";
export const CARE_CATEGORIES = ["Inpatient", "Outpatient", "Dental"] as const;
export type CareCategory = (typeof CARE_CATEGORIES)[number];
export type EvidenceState = "supported" | "not_supported" | "uncertain";
export type Evidence = {
  state: EvidenceState;
  citations: { documentId: string; quote: string }[];
};
export type CareEvidence = Record<CareCategory, Evidence>;
export type CareSubmission = {
  submissionId: string;
  submissionUse: "claim" | "preauthorization";
  memberId: string | null;
  policyId: string | null;
  providerId: string | null;
  serviceDate: string | null;
  documents: { id: string; text: string }[];
};
export type CareReason =
  | "REQUIRED_FIELDS_FAILED"
  | "MULTIPLE_CATEGORIES"
  | "EVIDENCE_UNCERTAIN"
  | "CATEGORY_NOT_FOUND"
  | "ONE_CATEGORY_CONFIRMED"
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_UNAVAILABLE";
export type CareDecision = {
  policyVersion: string;
  category: CareCategory | null;
  destination: CareCategory | "POOL_QUEUE";
  reason: CareReason;
  matchedCategories: CareCategory[];
  uncertainCategories: CareCategory[];
  missingFields: string[];
};

function usable(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !!value.trim() &&
    !/^(unknown|n\/?a|null|none|-1|-7|-8|-9|-15)$/i.test(value.trim())
  );
}

export function validateCareSubmission(input: CareSubmission): string[] {
  const failed: string[] = [];
  for (const field of [
    "submissionId",
    "memberId",
    "policyId",
    "providerId",
  ] as const) {
    if (!usable(input[field])) failed.push(field);
  }
  if (!["claim", "preauthorization"].includes(input.submissionUse))
    failed.push("submissionUse");
  const date = input.serviceDate;
  if (
    !usable(date) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    failed.push("serviceDate");
  if (
    !Array.isArray(input.documents) ||
    !input.documents.length ||
    input.documents.some((d) => !d || !usable(d.id) || !usable(d.text)) ||
    new Set(input.documents.map((d) => d.id)).size !== input.documents.length
  )
    failed.push("documents");
  return failed;
}

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Structural validation also checks exact quotes against the actual input documents. */
export function parseCareEvidence(
  value: unknown,
  input: CareSubmission,
): CareEvidence {
  if (
    !record(value) ||
    Object.keys(value).length !== 3 ||
    CARE_CATEGORIES.some((c) => !(c in value))
  ) {
    throw new Error("Expected evidence for exactly three named categories.");
  }
  const output = {} as CareEvidence;
  for (const category of CARE_CATEGORIES) {
    const e = value[category];
    if (
      !record(e) ||
      !["supported", "not_supported", "uncertain"].includes(String(e.state)) ||
      !Array.isArray(e.citations) ||
      Object.keys(e).some((k) => !["state", "citations"].includes(k))
    ) {
      throw new Error(`Invalid ${category} evidence.`);
    }
    const citations = e.citations.map((c) => {
      if (!record(c) || !usable(c.documentId) || !usable(c.quote))
        throw new Error("Missing evidence citation.");
      const doc = input.documents.find((d) => d.id === c.documentId);
      if (!doc || !doc.text.includes(c.quote))
        throw new Error("Evidence quote is absent from the cited document.");
      return { documentId: c.documentId, quote: c.quote };
    });
    if (e.state !== "not_supported" && !citations.length)
      throw new Error("Positive or uncertain evidence requires a quote.");
    output[category] = { state: e.state as EvidenceState, citations };
  }
  return output;
}

export function decideCareRoute(
  input: CareSubmission,
  evidence?: CareEvidence,
  failure?: "MODEL_OUTPUT_INVALID" | "MODEL_UNAVAILABLE",
): CareDecision {
  const base: CareDecision = {
    policyVersion: CARE_POLICY_VERSION,
    category: null,
    destination: "POOL_QUEUE",
    reason: "CATEGORY_NOT_FOUND",
    matchedCategories: [],
    uncertainCategories: [],
    missingFields: validateCareSubmission(input),
  };
  if (base.missingFields.length)
    return { ...base, reason: "REQUIRED_FIELDS_FAILED" };
  if (failure) return { ...base, reason: failure };
  if (!evidence) return { ...base, reason: "MODEL_OUTPUT_INVALID" };
  let verified: CareEvidence;
  try {
    verified = parseCareEvidence(evidence, input);
  } catch {
    return { ...base, reason: "MODEL_OUTPUT_INVALID" };
  }
  base.matchedCategories = CARE_CATEGORIES.filter(
    (c) => verified[c].state === "supported",
  );
  base.uncertainCategories = CARE_CATEGORIES.filter(
    (c) => verified[c].state === "uncertain",
  );
  if (base.matchedCategories.length > 1)
    return { ...base, reason: "MULTIPLE_CATEGORIES" };
  if (base.uncertainCategories.length)
    return { ...base, reason: "EVIDENCE_UNCERTAIN" };
  if (!base.matchedCategories.length) return base;
  const category = base.matchedCategories[0];
  return {
    ...base,
    category,
    destination: category,
    reason: "ONE_CATEGORY_CONFIRMED",
  };
}
