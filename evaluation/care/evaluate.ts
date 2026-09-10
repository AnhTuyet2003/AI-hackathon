import {
  CARE_CATEGORIES,
  decideCareRoute,
  parseCareEvidence,
  validateCareSubmission,
  type CareDecision,
  type CareEvidence,
  type CareSubmission,
} from "../../lib/care-routing";
import type { CareFixture } from "./fixtures";

export type EvaluationRow = {
  id: string;
  expected: CareFixture["expected"];
  actual: CareDecision;
  evidence: CareEvidence | null;
  classifierInvoked: boolean;
  modelError: boolean;
  correctDecision: boolean;
};

export function validateDataset(fixtures: CareFixture[]) {
  const ids = new Set<string>();
  const groups = new Map<string, string>();
  for (const f of fixtures) {
    if (ids.has(f.id)) throw new Error(`Duplicate fixture ${f.id}`);
    ids.add(f.id);
    if (groups.has(f.groupId) && groups.get(f.groupId) !== f.split)
      throw new Error(`Group leaks across splits: ${f.groupId}`);
    groups.set(f.groupId, f.split);
    parseCareEvidence(f.goldEvidence, f.input);
    const decision = decideCareRoute(f.input, f.goldEvidence);
    if (
      decision.category !== f.expected.category ||
      decision.reason !== f.expected.reason ||
      JSON.stringify(decision.missingFields) !==
        JSON.stringify(f.expected.missingFields)
    )
      throw new Error(`Inconsistent reference labels: ${f.id}`);
  }
  return {
    fixtureCount: fixtures.length,
    development: fixtures.filter((f) => f.split === "development").length,
    holdout: fixtures.filter((f) => f.split === "holdout").length,
    modelCalls: 0,
    modelAccuracy: null,
    labelStatus:
      fixtures.length > 0 &&
      fixtures.every((f) => f.reviewStatus === "reviewer_confirmed")
        ? "reviewer-confirmed synthetic references; reviewer identity self-declared"
        : fixtures.some((f) => f.reviewStatus === "reviewer_confirmed")
          ? "mixed reviewed and unreviewed synthetic references"
          : "authored synthetic references; domain review pending",
  };
}

export async function evaluate(
  fixtures: CareFixture[],
  classify: (input: CareSubmission) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
) {
  const rows: EvaluationRow[] = [];
  for (const fixture of fixtures) {
    let actual: CareDecision;
    let evidence: CareEvidence | null = null;
    let classifierInvoked = false;
    let modelError = false;
    if (validateCareSubmission(fixture.input).length) {
      actual = decideCareRoute(fixture.input);
    } else {
      classifierInvoked = true;
      let raw: unknown;
      try {
        raw = await classify(fixture.input);
      } catch {
        modelError = true;
      }
      if (modelError)
        actual = decideCareRoute(fixture.input, undefined, "MODEL_UNAVAILABLE");
      else {
        try {
          evidence = parseCareEvidence(
            typeof raw === "string" ? JSON.parse(raw) : raw,
            fixture.input,
          );
          actual = decideCareRoute(fixture.input, evidence);
        } catch {
          modelError = true;
          actual = decideCareRoute(
            fixture.input,
            undefined,
            "MODEL_OUTPUT_INVALID",
          );
        }
      }
    }
    const goldDecision = decideCareRoute(fixture.input, fixture.goldEvidence);
    const correctDecision =
      !modelError && JSON.stringify(actual) === JSON.stringify(goldDecision);
    rows.push({
      id: fixture.id,
      expected: fixture.expected,
      actual,
      evidence,
      classifierInvoked,
      modelError,
      correctDecision,
    });
    onProgress?.(rows.length, fixtures.length);
  }
  return { rows, metrics: summarize(fixtures, rows) };
}

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : null;
}
export function summarize(fixtures: CareFixture[], rows: EvaluationRow[]) {
  const references = new Map(fixtures.map((f) => [f.id, f]));
  const attempted = rows.filter((r) => r.classifierInvoked);
  const routes = rows.filter((r) => r.actual.category !== null);
  const perCategory = Object.fromEntries(
    CARE_CATEGORIES.map((category) => {
      let tp = 0,
        fp = 0,
        fn = 0;
      for (const r of attempted) {
        const expected =
          references.get(r.id)!.goldEvidence[category].state === "supported";
        const predicted = r.evidence?.[category].state === "supported";
        if (expected && predicted) tp++;
        if (!expected && predicted) fp++;
        if (expected && !predicted) fn++;
      }
      return [
        category,
        {
          truePositive: tp,
          falsePositive: fp,
          falseNegative: fn,
          precision: ratio(tp, tp + fp),
          recall: ratio(tp, tp + fn),
          f1: ratio(2 * tp, 2 * tp + fp + fn),
        },
      ];
    }),
  );
  const confusionMatrix: Record<string, Record<string, number>> = {};
  const poolReasons: Record<string, number> = {};
  for (const row of rows) {
    const expected = row.expected.category ?? "POOL_QUEUE";
    const predicted = row.actual.destination;
    confusionMatrix[expected] ??= {};
    confusionMatrix[expected][predicted] =
      (confusionMatrix[expected][predicted] ?? 0) + 1;
    if (predicted === "POOL_QUEUE")
      poolReasons[row.actual.reason] =
        (poolReasons[row.actual.reason] ?? 0) + 1;
  }
  const expectedConflicts = attempted.filter(
    (r) => r.expected.reason === "MULTIPLE_CATEGORIES",
  );
  const expectedUnknown = attempted.filter((r) =>
    ["CATEGORY_NOT_FOUND", "EVIDENCE_UNCERTAIN"].includes(r.expected.reason),
  );
  return {
    totalCases: rows.length,
    classificationAttempts: attempted.length,
    modelFailures: rows.filter((r) => r.modelError).length,
    commonGateFailures: rows.filter(
      (r) => r.actual.reason === "REQUIRED_FIELDS_FAILED",
    ).length,
    exactDecisionAccuracy: ratio(
      rows.filter((r) => r.correctDecision).length,
      rows.length,
    ),
    classificationDecisionAccuracy: ratio(
      attempted.filter((r) => r.correctDecision).length,
      attempted.length,
    ),
    autoRouteCoverage: ratio(routes.length, rows.length),
    autoRoutePrecision: ratio(
      routes.filter((r) => r.correctDecision).length,
      routes.length,
    ),
    conflictRecall: ratio(
      expectedConflicts.filter((r) => r.correctDecision).length,
      expectedConflicts.length,
    ),
    noCategoryOrUncertaintyRecall: ratio(
      expectedUnknown.filter((r) => r.correctDecision).length,
      expectedUnknown.length,
    ),
    perCategory,
    confusionMatrix,
    poolReasons,
  };
}
