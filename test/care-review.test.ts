import { careFixtures } from "../evaluation/care/fixtures";
import { evaluate } from "../evaluation/care/evaluate";
import {
  applyReviewedLabels,
  blankReview,
  completeReview,
  makeReviewPack,
  parseReviewPack,
  reviewAnswer,
} from "../lib/care-review";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function independent(id = "C001") {
  const f = careFixtures.find((f) => f.id === id)!;
  const r = blankReview(f);
  r.draft = {
    reviewer: "Test reviewer",
    fieldsChecked: true,
    missingFields: [...f.expected.missingFields],
    evidence: copy(f.goldEvidence),
    notes: "",
  };
  r.independent = reviewAnswer(r.draft, f);
  r.independentSavedAt = r.updatedAt;
  r.status = "independent";
  return { f, r };
}
function approved(id = "C001") {
  const { f, r } = independent(id);
  r.referenceViewedAt = r.updatedAt;
  return completeReview(r, f, "approved");
}

describe("Label Review", () => {
  test("new cases have no prefilled evidence or independent labels", () => {
    const draft = blankReview(careFixtures[0]);
    expect(draft.independent).toBeNull();
    expect(draft.referenceViewedAt).toBeNull();
    expect(Object.values(draft.draft.evidence).map((e) => e.state)).toEqual([
      "",
      "",
      "",
    ]);
  });
  test("incomplete forms cannot become independent judgements", () => {
    const { f, r } = independent();
    r.draft.reviewer = " ";
    expect(() => reviewAnswer(r.draft, f)).toThrow("reviewer name");
    r.draft.reviewer = "Reviewer";
    r.draft.fieldsChecked = false;
    expect(() => reviewAnswer(r.draft, f)).toThrow("required fields");
    r.draft.fieldsChecked = true;
    r.draft.evidence.Dental.state = "";
    expect(() => reviewAnswer(r.draft, f)).toThrow("all three");
  });
  test("evidence quotes must exist in their cited source", () => {
    const { f, r } = independent();
    r.draft.evidence.Inpatient.citations[0].quote = "invented admission";
    expect(() => reviewAnswer(r.draft, f)).toThrow("exact quote");
    r.draft.evidence.Inpatient.citations = [];
    expect(() => reviewAnswer(r.draft, f)).toThrow("exact quote");
  });
  test("finalization requires an independent record and reference comparison", () => {
    const { f, r } = independent();
    expect(() => completeReview(r, f, "approved")).toThrow("reveal");
    r.referenceViewedAt = r.updatedAt;
    r.independent = null;
    expect(() => completeReview(r, f, "approved")).toThrow("independent");
  });
  test("approval rejects category disagreement and correction requires a reason", () => {
    const { f, r } = independent();
    r.referenceViewedAt = r.updatedAt;
    r.draft = copy(r.draft);
    r.draft.evidence.Inpatient = { state: "not_supported", citations: [] };
    expect(() => completeReview(r, f, "approved")).toThrow("differ");
    expect(() => completeReview(r, f, "corrected")).toThrow("reason");
    r.draft.notes = "Test-only alternative label.";
    const result = completeReview(r, f, "corrected");
    expect(result.draft.evidence.Inpatient.state).toBe("not_supported");
    expect(result.independent!.evidence.Inpatient.state).toBe("supported");
  });
  test("field-rule disagreements can be discussed but cannot be finalized", () => {
    const { f, r } = independent();
    r.referenceViewedAt = r.updatedAt;
    r.draft.missingFields = ["policyId"];
    r.draft.notes = "Policy definition needs review.";
    expect(() => completeReview(r, f, "corrected")).toThrow("current rule");
    expect(completeReview(r, f, "discussion").status).toBe("discussion");
  });
  test.each(["C001", "C004", "C008", "C030", "C037"])(
    "export and restore preserve completed review %s",
    (id) => {
      const pack = makeReviewPack([approved(id)]);
      expect(parseReviewPack(copy(pack), careFixtures)).toEqual(pack);
    },
  );
  test("partial drafts are valid backups but not evaluation labels", () => {
    const pack = makeReviewPack([blankReview(careFixtures[0])]);
    expect(parseReviewPack(pack, careFixtures)).toEqual(pack);
    expect(() =>
      applyReviewedLabels(pack, careFixtures, "development"),
    ).toThrow("Finish the review for C001");
  });
  test("rejects changed source, wrong policy, duplicates and tampered finished evidence", () => {
    const pack = makeReviewPack([approved()]);
    const changed = copy(pack);
    changed.reviews[0].sourceSnapshot = "outdated";
    expect(() => parseReviewPack(changed, careFixtures)).toThrow(
      "changed source",
    );
    expect(() =>
      parseReviewPack({ ...pack, policyVersion: "old" }, careFixtures),
    ).toThrow("policy version");
    expect(() =>
      parseReviewPack(
        { ...pack, reviews: [...pack.reviews, ...pack.reviews] },
        careFixtures,
      ),
    ).toThrow("unique");
    const bad = copy(pack);
    bad.reviews[0].draft.evidence.Inpatient.citations[0].quote = "fabrication";
    expect(() => parseReviewPack(bad, careFixtures)).toThrow("exact quote");
  });
  test("rejects invalid restore forms before they reach the UI", () => {
    const pack = makeReviewPack([blankReview(careFixtures[0])]);
    const malformed = copy(pack) as unknown as {
      reviews: { draft: unknown }[];
    };
    malformed.reviews[0].draft = { reviewer: 42 };
    expect(() => parseReviewPack(malformed, careFixtures)).toThrow(
      "Invalid review form",
    );
  });
  test("selected split must be fully approved or corrected; discussion blocks it", () => {
    const reviews = careFixtures
      .filter((f) => f.split === "development")
      .map((f) => approved(f.id));
    reviews[1].status = "discussion";
    reviews[1].draft.notes = "Pending decision";
    expect(() =>
      applyReviewedLabels(makeReviewPack(reviews), careFixtures, "development"),
    ).toThrow("C002");
  });
  test("reviewed corrections become evaluator references without leaking into inputs", async () => {
    const reviews = careFixtures
      .filter((f) => f.split === "development")
      .map((f) => approved(f.id));
    const changed = reviews[0];
    changed.draft.evidence.Inpatient = {
      state: "not_supported",
      citations: [],
    };
    changed.draft.notes =
      "Test-only correction to demonstrate import, not a clinical label.";
    reviews[0] = completeReview(changed, careFixtures[0], "corrected");
    const fixtures = applyReviewedLabels(
      makeReviewPack(reviews),
      careFixtures,
      "development",
    );
    expect(fixtures[0].reviewStatus).toBe("reviewer_confirmed");
    expect(fixtures[0].expected.reason).toBe("CATEGORY_NOT_FOUND");
    expect(fixtures[0].input).toEqual(careFixtures[0].input);
    expect(fixtures.find((f) => f.split === "holdout")!.reviewStatus).toBe(
      "needs_domain_review",
    );
    const result = await evaluate(
      [fixtures[0]],
      async () => careFixtures[0].goldEvidence,
    );
    expect(result.metrics.exactDecisionAccuracy).toBe(0);
    expect(careFixtures[0].expected.category).toBe("Inpatient");
  });
});
