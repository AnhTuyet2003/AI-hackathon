import {
  CARE_CATEGORIES,
  CARE_POLICY_VERSION,
  decideCareRoute,
  parseCareEvidence,
  validateCareSubmission,
  type CareEvidence,
  type EvidenceState,
} from "./care-routing";
import type { CareFixture } from "../evaluation/care/fixtures";

export const REVIEW_STORAGE_KEY = "ai-ud-care-label-reviews-v1";
export const REVIEW_FIELDS = [
  "submissionId",
  "submissionUse",
  "memberId",
  "policyId",
  "providerId",
  "serviceDate",
  "documents",
] as const;
export type ReviewDraft = {
  reviewer: string;
  missingFields: string[];
  fieldsChecked: boolean;
  evidence: Record<
    string,
    {
      state: EvidenceState | "";
      citations: { documentId: string; quote: string }[];
    }
  >;
  notes: string;
};
export type ReviewAnswer = Omit<ReviewDraft, "evidence"> & {
  evidence: CareEvidence;
};
export type ReviewStatus =
  | "draft"
  | "independent"
  | "approved"
  | "corrected"
  | "discussion";
export type LabelReview = {
  id: string;
  sourceSnapshot: string;
  draft: ReviewDraft;
  independent: ReviewAnswer | null;
  independentSavedAt: string | null;
  referenceViewedAt: string | null;
  status: ReviewStatus;
  updatedAt: string;
};
export type ReviewPack = {
  schemaVersion: 1;
  policyVersion: string;
  exportedAt: string;
  reviews: LabelReview[];
};

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const timestamp = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const sameFields = (a: string[], b: string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function blankReview(fixture: CareFixture): LabelReview {
  return {
    id: fixture.id,
    sourceSnapshot: JSON.stringify(fixture.input),
    status: "draft",
    updatedAt: new Date().toISOString(),
    independent: null,
    independentSavedAt: null,
    referenceViewedAt: null,
    draft: {
      reviewer: "",
      missingFields: [],
      fieldsChecked: false,
      notes: "",
      evidence: Object.fromEntries(
        CARE_CATEGORIES.map((c) => [c, { state: "", citations: [] }]),
      ),
    },
  };
}

export function reviewAnswer(
  draft: ReviewDraft,
  fixture: CareFixture,
): ReviewAnswer {
  if (!draft.reviewer.trim()) throw new Error("Enter your reviewer name.");
  if (!draft.fieldsChecked)
    throw new Error("Confirm that you checked the required fields.");
  if (CARE_CATEGORIES.some((c) => !draft.evidence[c]?.state))
    throw new Error("Choose a label for all three categories.");
  let evidence: CareEvidence;
  try {
    evidence = parseCareEvidence(draft.evidence, fixture.input);
  } catch {
    throw new Error(
      "Supported and uncertain labels need an exact quote from the selected document. Check every evidence quote.",
    );
  }
  return { ...draft, reviewer: draft.reviewer.trim(), evidence };
}

export function agreesWithReference(
  answer: ReviewAnswer,
  fixture: CareFixture,
) {
  return (
    sameFields(answer.missingFields, fixture.expected.missingFields) &&
    CARE_CATEGORIES.every(
      (c) => answer.evidence[c].state === fixture.goldEvidence[c].state,
    )
  );
}

export function completeReview(
  review: LabelReview,
  fixture: CareFixture,
  status: "approved" | "corrected" | "discussion",
): LabelReview {
  if (!review.independent || !review.referenceViewedAt)
    throw new Error(
      "Save your independent judgement, then reveal the proposed labels first.",
    );
  const answer = reviewAnswer(review.draft, fixture);
  if (status !== "approved" && !answer.notes.trim())
    throw new Error("Add a reason for your correction or discussion.");
  if (status === "approved" && !agreesWithReference(answer, fixture))
    throw new Error(
      "Your labels differ from the proposal. Choose Save correction or Needs discussion.",
    );
  if (
    status !== "discussion" &&
    !sameFields(answer.missingFields, validateCareSubmission(fixture.input))
  ) {
    throw new Error(
      "Your required-field assessment differs from the current rule. Choose Needs discussion so the rule can be resolved before evaluation.",
    );
  }
  return {
    ...review,
    draft: answer,
    status,
    updatedAt: new Date().toISOString(),
  };
}

export function makeReviewPack(reviews: LabelReview[]): ReviewPack {
  return {
    schemaVersion: 1,
    policyVersion: CARE_POLICY_VERSION,
    exportedAt: new Date().toISOString(),
    reviews,
  };
}

/** Validate backups and evaluator imports; never silently accept stale or unresolved labels. */
export function parseReviewPack(
  value: unknown,
  fixtures: CareFixture[],
): ReviewPack {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.policyVersion !== CARE_POLICY_VERSION ||
    !timestamp(value.exportedAt) ||
    !Array.isArray(value.reviews)
  ) {
    throw new Error(
      "This is not a review export for the current policy version.",
    );
  }
  const ids = new Set<string>();
  const reviews = value.reviews.map((raw) => {
    if (!object(raw) || typeof raw.id !== "string" || ids.has(raw.id))
      throw new Error("Review IDs must be unique.");
    const fixture = fixtures.find((f) => f.id === raw.id);
    if (!fixture || raw.sourceSnapshot !== JSON.stringify(fixture.input))
      throw new Error(`Unknown or changed source case: ${raw.id}.`);
    ids.add(raw.id);
    const parseDraft = (v: unknown): ReviewDraft => {
      if (
        !object(v) ||
        typeof v.reviewer !== "string" ||
        typeof v.notes !== "string" ||
        typeof v.fieldsChecked !== "boolean" ||
        !Array.isArray(v.missingFields) ||
        v.missingFields.some(
          (f) => !REVIEW_FIELDS.includes(f as (typeof REVIEW_FIELDS)[number]),
        ) ||
        new Set(v.missingFields).size !== v.missingFields.length ||
        !object(v.evidence) ||
        Object.keys(v.evidence).length !== 3
      )
        throw new Error(`Invalid review form: ${raw.id}.`);
      for (const c of CARE_CATEGORIES) {
        const e = v.evidence[c];
        if (
          !object(e) ||
          !["", "supported", "not_supported", "uncertain"].includes(
            String(e.state),
          ) ||
          !Array.isArray(e.citations) ||
          e.citations.some(
            (q) =>
              !object(q) ||
              typeof q.documentId !== "string" ||
              typeof q.quote !== "string",
          )
        )
          throw new Error(`Invalid category form: ${raw.id}.`);
      }
      return v as ReviewDraft;
    };
    if (
      !["draft", "independent", "approved", "corrected", "discussion"].includes(
        String(raw.status),
      ) ||
      !timestamp(raw.updatedAt) ||
      !(raw.independentSavedAt === null || timestamp(raw.independentSavedAt)) ||
      !(raw.referenceViewedAt === null || timestamp(raw.referenceViewedAt))
    )
      throw new Error(`Invalid review status: ${raw.id}.`);
    const draft = parseDraft(raw.draft);
    const independent =
      raw.independent === null
        ? null
        : reviewAnswer(parseDraft(raw.independent), fixture);
    if (
      Boolean(independent) !== Boolean(raw.independentSavedAt) ||
      (raw.referenceViewedAt && !independent) ||
      (raw.status !== "draft" && !independent)
    )
      throw new Error(`Missing independent judgement: ${raw.id}.`);
    const review = { ...raw, draft, independent } as LabelReview;
    if (["approved", "corrected", "discussion"].includes(review.status))
      completeReview(
        review,
        fixture,
        review.status as "approved" | "corrected" | "discussion",
      );
    return review;
  });
  return {
    schemaVersion: 1,
    policyVersion: CARE_POLICY_VERSION,
    exportedAt: value.exportedAt,
    reviews,
  };
}

export function applyReviewedLabels(
  pack: ReviewPack,
  fixtures: CareFixture[],
  split: CareFixture["split"],
): CareFixture[] {
  const checked = parseReviewPack(pack, fixtures);
  return fixtures.map((fixture) => {
    if (fixture.split !== split) return fixture;
    const review = checked.reviews.find((r) => r.id === fixture.id);
    if (!review || !["approved", "corrected"].includes(review.status))
      throw new Error(
        `Finish the review for ${fixture.id} before evaluating the ${split} set.`,
      );
    const answer = reviewAnswer(review.draft, fixture);
    const decision = decideCareRoute(fixture.input, answer.evidence);
    return {
      ...fixture,
      goldEvidence: answer.evidence,
      reviewStatus: "reviewer_confirmed",
      expected: {
        category: decision.category,
        reason: decision.reason,
        missingFields: decision.missingFields,
      },
    };
  });
}
