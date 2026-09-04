import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Underwriter } from "./types";

// Wraps chuk-mcp-solver's `solve_assignment_problem` tool (IBM/chuk-mcp-solver), called over MCP
// against the hosted endpoint. One case = one task; eligible underwriters = agents. On any failure
// (network, tool error, malformed response) the caller falls back to the local greedy matcher in
// lib/matching.ts -- this integration must never be a hard dependency for the demo.

export type SolverAssignment = { task_id: string; agent_id: string; cost: number };

export type SolveAssignmentProblemResponse = {
  status: "OPTIMAL" | "FEASIBLE" | "SATISFIED" | "INFEASIBLE" | "UNBOUNDED" | "TIMEOUT_BEST" | "TIMEOUT_NO_SOLUTION" | "ERROR";
  assignments: SolverAssignment[];
  unassigned_tasks: string[];
  agent_load: Record<string, number>;
  total_cost: number;
  solve_time_ms: number;
  optimality_gap: number | null;
  explanation: { summary: string; overloaded_agents?: string[]; underutilized_agents?: string[] };
};

function endpoint() {
  return process.env.MCP_SOLVER_URL || "https://solver.chukai.io/mcp";
}

// Lower cost = more desirable underwriter, so the solver's MINIMIZE_COST objective naturally
// implements the priority order from the module proposal: lowest queue depth -> closest
// specialization match -> tightest SLA.
function costFor(uw: Underwriter, specialtiesRequired: string[]): number {
  const specialtyOverlap = specialtiesRequired.filter((s) => uw.specializationTags.includes(s)).length;
  const specialtyPenalty = specialtiesRequired.length > 0 ? (specialtiesRequired.length - specialtyOverlap) * 50 : 0;
  return uw.currentQueueLoad * 10 + specialtyPenalty + uw.slaMinutesRemainingAvg / 60;
}

export async function solveAssignmentViaMcp(
  caseId: string,
  eligibleUnderwriters: Underwriter[],
  specialtiesRequired: string[]
): Promise<{ chosenUnderwriterId: string | null; raw: SolveAssignmentProblemResponse }> {
  if (eligibleUnderwriters.length === 0) {
    throw new Error("No eligible underwriters to submit to the solver.");
  }

  const transport = new StreamableHTTPClientTransport(new URL(endpoint()));
  const client = new Client({ name: "ai-underwriting-dispatcher", version: "1.0.0" });

  try {
    await client.connect(transport);

    const result = await client.callTool({
      name: "solve_assignment_problem",
      arguments: {
        agents: eligibleUnderwriters.map((uw) => ({
          id: uw.id,
          capacity: 1,
          skills: uw.specializationTags,
          cost_multiplier: 1.0
        })),
        tasks: [{ id: caseId, required_skills: [], duration: 1, priority: 1 }],
        cost_matrix: [eligibleUnderwriters.map((uw) => costFor(uw, specialtiesRequired))],
        objective: "minimize_cost",
        force_assign_all: true,
        max_time_ms: 15000
      }
    });

    const content = Array.isArray((result as { content?: unknown }).content) ? (result as { content: Array<{ type: string; text?: string }> }).content : [];
    const textPart = content.find((part) => part.type === "text" && typeof part.text === "string");
    if (!textPart?.text) throw new Error("Solver response had no parseable content.");

    const parsed = JSON.parse(textPart.text) as SolveAssignmentProblemResponse;
    const assignment = parsed.assignments?.find((a) => a.task_id === caseId);

    return { chosenUnderwriterId: assignment?.agent_id ?? null, raw: parsed };
  } finally {
    await client.close().catch(() => undefined);
  }
}
