# AI-Underwriting Dispatcher (AI-UD)

Working prototype for **GIF AI Hackathon 2026 -- Track 1: BFSI AI Agent**. AI-UD reads a new life
insurance application, scores its complexity, extracts specialist medical/financial entities, and
auto-routes the case to the optimal underwriter within seconds -- replacing a manual 24-48 hour
assignment process. Implements the module proposal and end-to-end flow diagram supplied alongside
`AI-UD_Build_Prompt.md` for this hackathon track.

## Stack

Single Next.js 16 + TypeScript + Tailwind app (frontend + API routes together), per Option B of
`AI-UD_Build_Prompt.md`. Case data persists to `localStorage` client-side for the demo (no
database needed).

## Quick start

```bash
npm install
npm run dev   # http://localhost:3000
```

Works with **zero external API calls** out of the box (deterministic fallback engine). To enable
live Gemini-powered scoring, copy `.env.local.example` to `.env.local` and set `GEMINI_API_KEY`.

## How the flow maps to the module proposal

| Proposal step | Where it lives |
|---|---|
| Phase 1 -- Submission, completeness check | [app/submit](app/submit), [lib/mock-ai.ts](lib/mock-ai.ts) `detectMissingFields` |
| Component A -- Complexity Classifier | [lib/mock-ai.ts](lib/mock-ai.ts) `scoreComplexity` (fallback), [lib/gemini-ai.ts](lib/gemini-ai.ts) (live) |
| Component B -- NER Specialization | [lib/mock-ai.ts](lib/mock-ai.ts) `extractEntities` (fallback), [lib/gemini-ai.ts](lib/gemini-ai.ts) (live) |
| Component C -- Filter Node (8 named policies) | [lib/policies.ts](lib/policies.ts) |
| Component C -- Optimization Node | [lib/matching.ts](lib/matching.ts) + [lib/mcp-solver.ts](lib/mcp-solver.ts) |
| Orchestration / STP vs Manual vs Escalated | [lib/pipeline.ts](lib/pipeline.ts) |
| Explainability (AI decision trace) | [components/CaseDetailClient.tsx](components/CaseDetailClient.tsx) |
| Pool Queue / Ops Manager override | [app/pool-queue](app/pool-queue) |
| Audit log | [app/audit](app/audit) |

## How the 3 reference repos were used

- **[Anshumaan657/CoverOps-AI](https://github.com/Anshumaan657/CoverOps-AI)** (cloned to
  `reference/coverops-ai/`, read-only): the whole project structure is adapted from it --
  Next.js App Router shape, `lib/types.ts` / `lib/mock-ai.ts` / `lib/local-store.ts` /
  `lib/validation.ts` patterns, the `IntakeInput -> API route -> InsuranceCase` request/response
  shape, and critically its **deterministic fallback pattern** (`lib/mock-ai.ts` there ->
  our `lib/mock-ai.ts`, used as the mandatory zero-API-call engine). The "AI Decision Trace" UI in
  `CaseDetailClient.tsx` there is reused directly as the shape of our Explainability panel
  (policy pass/fail + reason code + NER entities instead of missing-fields + risk factors).
- **[aurelius-in/Claims-Triage-AI](https://github.com/aurelius-in/Claims-Triage-AI)** (Python,
  read via GitHub API/raw fetches, not cloned -- its runtime is Python and doesn't fit this
  project's all-TypeScript constraint): reused its *architectural pattern*, not its code --
  a sequential agent pipeline (`lib/pipeline.ts`), a `RiskScorerAgent`-style
  `{score, reasonCode, driverFactors}` shape for Component A, and its `RouterAgent`
  policy-as-code idea (`policies/routing.rego` + OPA) reimplemented as plain TypeScript functions
  driven by declarative rule config in `lib/policies.ts` (no OPA/Rego runtime added, per the
  build spec's stack constraint).
- **[IBM/chuk-mcp-solver](https://github.com/IBM/chuk-mcp-solver)**: called live over MCP
  (`@modelcontextprotocol/sdk`, `StreamableHTTPClientTransport`) against the hosted endpoint
  `https://solver.chukai.io/mcp`, invoking its `solve_assignment_problem` tool
  (`lib/mcp-solver.ts`) -- eligible underwriters become `agents`, the case becomes one `task`,
  and a cost matrix encodes the proposal's priority order (lowest queue depth -> closest
  specialization match -> tightest SLA) as a `minimize_cost` objective. If the solver call fails
  for any reason (network, timeout, malformed response), `lib/matching.ts` falls back to a local
  greedy matcher implementing the same priority order, so the Optimization Node never blocks the
  demo on external connectivity.

## Demo scenarios (seeded on first load, see `lib/seed.ts`)

1. **Clean / STP** -- low complexity (score 1-3), auto-assigned with no human review.
2. **Specialist match** -- medium complexity with a Cardiology disclosure, routed to the one
   underwriter (Sarah Jenkins) whose specialization tags and authority limit both clear the
   Filter Node.
3. **High complexity / escalation** -- score 8-10, high Sum Assured; both Medical-tier
   underwriters are unavailable (one DND, one over the workload cap), so no one passes the
   gating policies and the case lands in the Pool Queue for Ops Manager override.

The "Fill demo case" buttons on `/submit` reproduce these three scenarios live through the full
pipeline (including a real solver.chukai.io call) instead of just replaying the static seed data.

## Deterministic fallback mode (hard requirement)

`lib/gemini-ai.ts` throws on any failure (missing key, invalid JSON, quota, network), and
`lib/pipeline.ts` catches that and re-runs Component A/B synchronously via `lib/mock-ai.ts`,
logging a `Gemini unavailable -- deterministic fallback used` audit event. Verified by running the
full flow with no `GEMINI_API_KEY` set at all (the default state of this repo).

## Non-goals (kept out of scope, per the build spec)

No production auth, no real OCR/EHR integration (stubbed as file-name strings), no
time-window/pickup-delivery scheduling from chuk-mcp-solver.
