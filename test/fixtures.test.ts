import { applicationFixtures } from "@/test/fixtures/applications";
import { runIntakePipeline } from "@/lib/pipeline";
import { solveAssignmentViaMcp } from "@/lib/mcp-solver";
import { extractEntities, scoreComplexity } from "@/lib/mock-ai";
import { evaluateUnderwriter } from "@/lib/policies";
import { parseApplicationInput } from "@/lib/validation";
import { underwriterRegistry } from "@/lib/underwriters";
import type { ComplexityResult, NERResult } from "@/lib/types";

jest.mock("@/lib/gemini-ai", () => ({
  runGeminiAnalysis: jest
    .fn()
    .mockRejectedValue(new Error("Gemini disabled for Jest fixtures.")),
}));

jest.mock("@/lib/mcp-solver", () => ({
  solveAssignmentViaMcp: jest.fn(),
}));

const mockedSolver = jest.mocked(solveAssignmentViaMcp);

function mockSuccessfulSolver() {
  mockedSolver.mockImplementation(async (caseId, eligibleUnderwriters) => ({
    chosenUnderwriterId: eligibleUnderwriters[0]?.id ?? null,
    raw: {
      status: "OPTIMAL",
      assignments: eligibleUnderwriters[0]
        ? [{ task_id: caseId, agent_id: eligibleUnderwriters[0].id, cost: 0 }]
        : [],
      unassigned_tasks: eligibleUnderwriters[0] ? [] : [caseId],
      agent_load: Object.fromEntries(
        eligibleUnderwriters.map((underwriter) => [
          underwriter.id,
          underwriter.id === eligibleUnderwriters[0]?.id ? 1 : 0,
        ]),
      ),
      total_cost: 0,
      solve_time_ms: 0,
      optimality_gap: 0,
      explanation: {
        summary: "Mocked optimal assignment for deterministic Jest tests.",
      },
    },
  }));
}

describe("AI-UD deterministic fixture pipeline", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "";
    mockSuccessfulSolver();
  });

  it.each(applicationFixtures)(
    "matches the expected outcome: \$key",
    async (fixture) => {
      const result = await runIntakePipeline(fixture.input);
      const expectedStatus =
        fixture.expected.status === "RESOLVED"
          ? fixture.expected.decisionPath === "STP"
            ? "ASSIGNED_STP"
            : fixture.expected.decisionPath === "MANUAL"
              ? "ASSIGNED_MANUAL"
              : "POOL_QUEUE"
          : fixture.expected.status;

      expect(result.complexity?.band).toBe(fixture.expected.band);
      expect(result.decisionPath).toBe(fixture.expected.decisionPath);
      expect(result.status).toBe(expectedStatus);
      expect(result.ner?.specialtiesRequired.slice().sort()).toEqual(
        fixture.expected.specialties.slice().sort(),
      );
      expect(result.provider).toBe("fallback");
      expect(
        result.audit.some((event) =>
          event.action.includes("deterministic fallback"),
        ),
      ).toBe(true);

      if (fixture.expected.missingFields) {
        expect(result.missingFields.slice().sort()).toEqual(
          fixture.expected.missingFields.slice().sort(),
        );
      }
    },
  );

  it("produces a concrete follow-up message for incomplete applications", async () => {
    const fixture = applicationFixtures.find(
      (item) => item.key === "incomplete-missing-history-and-docs",
    );
    expect(fixture).toBeDefined();

    const result = await runIntakePipeline(fixture!.input);

    expect(result.missingFields).toEqual([
      "medical history / doctor notes",
      "supporting documents",
    ]);
    expect(result.followUpMessage).toContain("medical history / doctor notes");
    expect(result.followUpMessage).toContain("supporting documents");
  });
});

describe("deterministic AI fixtures", () => {
  it("extracts specialist entities and scores their risk drivers", () => {
    const input = applicationFixtures.find(
      (item) => item.key === "manual-cardiology-senior",
    )!.input;
    const ner = extractEntities(input);
    const complexity = scoreComplexity(input, ner);

    expect(ner.specialtiesRequired).toContain("Cardiology");
    expect(ner.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ specialization: "Cardiology" }),
      ]),
    );
    expect(complexity.band).toBe("medium");
    expect(complexity.driverFactors).toEqual(
      expect.arrayContaining([expect.stringContaining("Cardiology")]),
    );
  });
});

describe("policy fixture coverage", () => {
  const cleanComplexity: ComplexityResult = {
    score: 2,
    caseComplexityScore: 2,
    band: "low",
    reasonCode: "Clean fixture",
    driverFactors: [],
    applicationComplexityScore: 2,
    clinicalComplexityScore: 1,
    complexityConfidence: 0.9,
    complexityEvidence: []
  };
  const noSpecialty: NERResult = { entities: [], specialtiesRequired: [], confidence: 0.9 };

  it("passes an active underwriter with enough authority and capacity", () => {
    const underwriter = underwriterRegistry.find(
      (item) => item.id === "UW-TBECKER",
    )!;
    const evaluation = evaluateUnderwriter(
      underwriter,
      80_000,
      noSpecialty,
      cleanComplexity,
    );

    expect(evaluation.eligible).toBe(true);
    expect(evaluation.policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ policy: "Authority Limit", passed: true }),
        expect.objectContaining({ policy: "Availability", passed: true }),
        expect.objectContaining({ policy: "Workload Balancing", passed: true }),
        expect.objectContaining({
          policy: "Bias & Fairness Guardrail",
          passed: true,
        }),
      ]),
    );
  });

  it("excludes a candidate that fails authority, specialization, workload, or availability", () => {
    const cardiacNer: NERResult = {
      entities: [
        { text: "Myocardial Infarction", specialization: "Cardiology" },
      ],
      specialtiesRequired: ["Cardiology"],
      confidence: 0.85
    };
    const highComplexity: ComplexityResult = {
      ...cleanComplexity,
      score: 9,
      band: "high",
    };
    const unavailableMedical = underwriterRegistry.find(
      (item) => item.id === "UW-AMINH",
    )!;
    const evaluation = evaluateUnderwriter(
      unavailableMedical,
      2_000_000,
      cardiacNer,
      highComplexity,
    );

    expect(evaluation.eligible).toBe(false);
    expect(evaluation.policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ policy: "Authority Limit", passed: true }),
        expect.objectContaining({ policy: "Availability", passed: false }),
        expect.objectContaining({ policy: "Specialization", passed: false }),
      ]),
    );
  });
});

describe("matching fallback", () => {
  it("uses the local matcher when MCP is unavailable", async () => {
    mockedSolver.mockRejectedValueOnce(new Error("MCP unavailable in test"));

    const result = await (
      await import("@/lib/matching")
    ).runMatching(
      "APP-TEST",
      80_000,
      { entities: [], specialtiesRequired: [], confidence: 0.9 },
      { score: 2, caseComplexityScore: 2, band: "low", reasonCode: "Clean", driverFactors: [], applicationComplexityScore: 2, clinicalComplexityScore: 1, complexityConfidence: 0.9, complexityEvidence: [] },
    );

    expect(result.engine).toBe("greedy-fallback");
    expect(result.chosenUnderwriterId).toBe("UW-TBECKER");
    expect(result.rationale).toContain("used local greedy matcher");
  });
});

describe("validation fixtures", () => {
  it("normalizes valid application input", () => {
    const parsed = parseApplicationInput({
      ...applicationFixtures[0].input,
      applicantName: "  Nguyễn   Văn An ",
      age: "29",
      documents: [" application-form.pdf ", 42, "id-verification.pdf"],
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toMatchObject({
      applicantName: "Nguyễn Văn An",
      age: 29,
      documents: ["application-form.pdf", "id-verification.pdf"],
    });
  });

  it("rejects an application without an applicant name", () => {
    const parsed = parseApplicationInput({
      ...applicationFixtures[0].input,
      applicantName: "",
    });

    expect(parsed.data).toBeUndefined();
    expect(parsed.error).toBe("Applicant name is required.");
  });
});
