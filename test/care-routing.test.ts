import {
  CARE_CATEGORIES,
  decideCareRoute,
  parseCareEvidence,
  validateCareSubmission,
  type CareEvidence,
} from "../lib/care-routing";
import { careFixtures } from "../evaluation/care/fixtures";
import { evaluate, validateDataset } from "../evaluation/care/evaluate";
import { modelInput } from "../evaluation/care/model";

const get = (id: string) => careFixtures.find((f) => f.id === id)!;

describe("treatment routing specification", () => {
  it("checks labels, exact evidence quotes and disjoint partitions", () => {
    expect(validateDataset(careFixtures)).toMatchObject({
      fixtureCount: 37,
      development: 12,
      holdout: 25,
      modelCalls: 0,
      modelAccuracy: null,
    });
  });

  it.each(careFixtures)(
    "reference decision obeys the policy: $id $scenario",
    (f) => {
      expect(decideCareRoute(f.input, f.goldEvidence)).toMatchObject(
        f.expected,
      );
    },
  );

  it("handles all eight combinations without forced single-label prediction", () => {
    const input = {
      ...get("C001").input,
      documents: [{ id: "D1", text: "Evidence for the current services." }],
    };
    for (let mask = 0; mask < 8; mask++) {
      const evidence = Object.fromEntries(
        CARE_CATEGORIES.map((c, i) => [
          c,
          {
            state: mask & (1 << i) ? "supported" : "not_supported",
            citations:
              mask & (1 << i) ? [{ documentId: "D1", quote: "Evidence" }] : [],
          },
        ]),
      ) as CareEvidence;
      const supported = CARE_CATEGORIES.filter((_, i) => mask & (1 << i));
      const decision = decideCareRoute(input, evidence);
      expect(decision.category).toBe(
        supported.length === 1 ? supported[0] : null,
      );
      expect(decision.matchedCategories).toEqual(supported);
    }
  });

  it.each([null, "", " ", "unknown", "N/A", "-8"])(
    "rejects an unusable required identifier: %p",
    (memberId) => {
      expect(
        validateCareSubmission({ ...get("C001").input, memberId }),
      ).toContain("memberId");
    },
  );

  it.each(["2026-02-30", "2026-13-01", "2026-08", "not-a-date"])(
    "rejects invalid or incomplete dates: %s",
    (serviceDate) => {
      expect(
        validateCareSubmission({ ...get("C001").input, serviceDate }),
      ).toContain("serviceDate");
    },
  );

  it("accepts a real leap day and detects duplicate document IDs", () => {
    const input = { ...get("C001").input, serviceDate: "2024-02-29" };
    expect(validateCareSubmission(input)).toEqual([]);
    expect(
      validateCareSubmission({
        ...input,
        documents: [input.documents[0], input.documents[0]],
      }),
    ).toContain("documents");
  });

  it("rejects invented quotes, missing categories and unsupported states", () => {
    const { input, goldEvidence } = get("C001");
    expect(() =>
      parseCareEvidence(
        {
          ...goldEvidence,
          Inpatient: {
            state: "supported",
            citations: [{ documentId: "D1", quote: "fabricated" }],
          },
        },
        input,
      ),
    ).toThrow();
    expect(() =>
      parseCareEvidence({ Inpatient: goldEvidence.Inpatient }, input),
    ).toThrow();
    expect(() =>
      parseCareEvidence(
        { ...goldEvidence, Dental: { state: "probably", citations: [] } },
        input,
      ),
    ).toThrow();
    expect(
      decideCareRoute(input, {
        ...goldEvidence,
        Dental: { state: "supported", citations: [] },
      }),
    ).toMatchObject({ category: null, reason: "MODEL_OUTPUT_INVALID" });
  });

  it("requires uncertainty to be resolved even with one supported category", () => {
    const f = get("C027");
    expect(decideCareRoute(f.input, f.goldEvidence)).toMatchObject({
      category: null,
      reason: "EVIDENCE_UNCERTAIN",
      matchedCategories: ["Dental"],
    });
  });

  it("detects duplicate IDs and group leakage in the evaluation set", () => {
    expect(() => validateDataset([get("C001"), get("C001")])).toThrow(
      "Duplicate",
    );
    expect(() =>
      validateDataset([
        get("C001"),
        { ...get("C013"), groupId: get("C001").groupId },
      ]),
    ).toThrow("leaks");
  });

  it("exposes only submission text, purpose and date to the model", () => {
    const input = {
      ...get("C001").input,
      expected: "Dental",
      scenario: "secret-label",
      split: "holdout",
      goldEvidence: {},
    };
    expect(Object.keys(modelInput(input)).sort()).toEqual([
      "documents",
      "serviceDate",
      "submissionUse",
    ]);
    expect(JSON.stringify(modelInput(input))).not.toContain("secret-label");
  });
});

describe("evaluation accounting", () => {
  it("does not invoke the classifier for a failed first gate", async () => {
    const classify = jest.fn();
    const report = await evaluate([get("C021")], classify);
    expect(classify).not.toHaveBeenCalled();
    expect(report.metrics).toMatchObject({
      classificationAttempts: 0,
      classificationDecisionAccuracy: null,
      autoRoutePrecision: null,
    });
    expect(report.rows[0].actual.reason).toBe("REQUIRED_FIELDS_FAILED");
  });

  it("records unavailable models as failures rather than correct abstentions", async () => {
    const report = await evaluate([get("C007")], async () => {
      throw new Error("provider unavailable");
    });
    expect(report.rows[0]).toMatchObject({
      correctDecision: false,
      modelError: true,
      actual: { reason: "MODEL_UNAVAILABLE" },
    });
    expect(report.metrics.exactDecisionAccuracy).toBe(0);
    expect(report.metrics.modelFailures).toBe(1);
  });

  it("counts invalid output against accuracy and expected positive recall", async () => {
    const report = await evaluate([get("C001")], async () => "invalid json");
    expect(report.rows[0].actual.reason).toBe("MODEL_OUTPUT_INVALID");
    expect(report.metrics.perCategory.Inpatient).toMatchObject({
      falseNegative: 1,
      recall: 0,
      precision: null,
    });
  });

  it("detects missed overlap even if one of the two categories was correct", async () => {
    const f = get("C004");
    const prediction = {
      ...f.goldEvidence,
      Dental: { state: "not_supported", citations: [] },
    };
    const report = await evaluate([f], async () => prediction);
    expect(report.metrics).toMatchObject({
      autoRoutePrecision: 0,
      conflictRecall: 0,
      classificationDecisionAccuracy: 0,
    });
    expect(report.metrics.perCategory.Dental).toMatchObject({
      falseNegative: 1,
      recall: 0,
    });
  });

  it("computes mixed prediction metrics with explicit denominators", async () => {
    const fixtures = [get("C001"), get("C002"), get("C004"), get("C008")];
    const report = await evaluate(fixtures, async (input) => {
      const f = fixtures.find(
        (f) => f.input.submissionId === input.submissionId,
      )!;
      return f.id === "C004"
        ? {
            ...f.goldEvidence,
            Dental: { state: "not_supported", citations: [] },
          }
        : f.goldEvidence;
    });
    expect(report.metrics).toMatchObject({
      totalCases: 4,
      classificationAttempts: 3,
      commonGateFailures: 1,
      exactDecisionAccuracy: 0.75,
      classificationDecisionAccuracy: 2 / 3,
      autoRouteCoverage: 0.75,
      autoRoutePrecision: 2 / 3,
    });
    expect(report.metrics.confusionMatrix.POOL_QUEUE.Inpatient).toBe(1);
  });
});
