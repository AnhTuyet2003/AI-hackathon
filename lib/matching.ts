import { solveAssignmentViaMcp } from "./mcp-solver";
import { evaluateUnderwriter } from "./policies";
import { getUnderwriters } from "./underwriters";
import type {
  ComplexityResult,
  MatchResult,
  NERResult,
  Underwriter,
  UnderwriterEvaluation,
} from "./types";

// Optimization Node / Smart Allocation Matrix (Component C, part 2). Evaluates every underwriter
// against the Filter Node policies, then hands the eligible pool to chuk-mcp-solver's
// solve_assignment_problem (lib/mcp-solver.ts). If that call fails for any reason -- network,
// solver error, no hosted endpoint reachable -- falls back to a local greedy matcher implementing
// the same priority order (lowest queue depth -> closest specialization match -> tightest SLA), so
// the demo never breaks on external connectivity.

function specialtyOverlap(uw: Underwriter, specialtiesRequired: string[]) {
  return specialtiesRequired.filter((s) => uw.specializationTags.includes(s))
    .length;
}

function greedyPick(
  eligible: Underwriter[],
  specialtiesRequired: string[],
): Underwriter {
  return [...eligible].sort((a, b) => {
    if (a.currentQueueLoad !== b.currentQueueLoad)
      return a.currentQueueLoad - b.currentQueueLoad;
    const overlapDiff =
      specialtyOverlap(b, specialtiesRequired) -
      specialtyOverlap(a, specialtiesRequired);
    if (overlapDiff !== 0) return overlapDiff;
    return a.slaMinutesRemainingAvg - b.slaMinutesRemainingAvg;
  })[0];
}

// Sync core shared by the async solver-backed path and by lib/seed.ts (which builds demo cases
// at module load time with zero network calls).
export function evaluateAndRank(
  sumAssured: number,
  ner: NERResult,
  complexity: ComplexityResult,
  excludeUnderwriterId?: string,
  // Optional snapshot of the registry to evaluate against. lib/seed.ts passes an evolving copy
  // (queue loads incremented as each demo case is assigned) so seeded assignments spread across
  // the roster instead of every no-specialty case piling onto the single lowest-queue underwriter.
  registryOverride?: Underwriter[],
  careCategory?: string | null,
) {
  const pool = (registryOverride ?? getUnderwriters()).filter(
    (uw) => uw.id !== excludeUnderwriterId,
  );
  const evaluations: UnderwriterEvaluation[] = pool.map((uw) =>
    evaluateUnderwriter(uw, sumAssured, ner, complexity, careCategory),
  );
  const eligibleIds = new Set(
    evaluations.filter((e) => e.eligible).map((e) => e.underwriterId),
  );
  const eligibleUnderwriters = pool.filter((uw) => eligibleIds.has(uw.id));

  const ranked = [...eligibleUnderwriters].sort((a, b) => {
    if (a.currentQueueLoad !== b.currentQueueLoad)
      return a.currentQueueLoad - b.currentQueueLoad;
    const overlapDiff =
      specialtyOverlap(b, ner.specialtiesRequired) -
      specialtyOverlap(a, ner.specialtiesRequired);
    if (overlapDiff !== 0) return overlapDiff;
    return a.slaMinutesRemainingAvg - b.slaMinutesRemainingAvg;
  });
  ranked.forEach((uw, idx) => {
    const evalItem = evaluations.find((e) => e.underwriterId === uw.id);
    if (evalItem) evalItem.matchRank = idx + 1;
  });

  return { evaluations, eligibleUnderwriters: ranked };
}

export async function runMatching(
  caseId: string,
  sumAssured: number,
  ner: NERResult,
  complexity: ComplexityResult,
  excludeUnderwriterId?: string,
  careCategory?: string | null,
): Promise<MatchResult> {
  const { evaluations, eligibleUnderwriters } = evaluateAndRank(
    sumAssured,
    ner,
    complexity,
    excludeUnderwriterId,
    undefined,
    careCategory,
  );

  // Escalation Policy (#8): no qualifying underwriter -> Pool Queue, handled by the caller.
  if (eligibleUnderwriters.length === 0) {
    return {
      chosenUnderwriterId: null,
      evaluations,
      engine: "greedy-fallback",
      rationale:
        "No underwriter passed all gating policies (Authority Limit, Specialization, Workload Balancing, Availability, Care Group Routing) -- Escalation Policy triggered.",
    };
  }

  try {
    const { chosenUnderwriterId, raw } = await solveAssignmentViaMcp(
      caseId,
      eligibleUnderwriters,
      ner.specialtiesRequired,
    );
    if (!chosenUnderwriterId)
      throw new Error("Solver returned no assignment for this case.");

    return {
      chosenUnderwriterId,
      evaluations,
      engine: "mcp-solver",
      rationale: `chuk-mcp-solver (${raw.status}): ${raw.explanation?.summary || "optimal assignment minimizing queue load + specialization mismatch + SLA cost."}`,
    };
  } catch (error) {
    const chosen = greedyPick(eligibleUnderwriters, ner.specialtiesRequired);
    return {
      chosenUnderwriterId: chosen.id,
      evaluations,
      engine: "greedy-fallback",
      rationale: `chuk-mcp-solver unavailable (${error instanceof Error ? error.message : "unknown error"}); used local greedy matcher: lowest queue depth -> closest specialization match -> tightest SLA.`,
    };
  }
}
