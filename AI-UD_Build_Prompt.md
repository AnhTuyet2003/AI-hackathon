# AI-Underwriting Dispatcher (AI-UD) — Build Specification Prompt

> Copy everything below into Claude Code (or another coding agent) as the starting instruction for building the AI-UD prototype for the GIF AI Hackathon 2026 (Track 1: BFSI AI Agent).

---

## 1. Role & Goal

You are a senior full-stack engineer building a working prototype of **AI-Underwriting Dispatcher (AI-UD)** — an AI agent that automatically reads new life-insurance applications, scores their complexity, and routes each case to the right underwriter within minutes instead of the current 24–48 hour manual assignment process.

Build this as a runnable project (backend API + minimal frontend/dashboard), not just a design doc. Use the three reference repositories below as your primary implementation basis — reuse their agent patterns, schemas, and libraries wherever they fit, instead of writing everything from scratch.

## 2. Reference repositories (study these first, then reuse/adapt their code)

1. **https://github.com/aurelius-in/Claims-Triage-AI** — closest architectural match. It already implements a 5-agent pipeline for insurance case triage:
   - `ClassifierAgent` (zero-shot LLM + ML fallback) — reuse this pattern for our **Complexity Classifier**.
   - `RiskScorerAgent` (XGBoost + SHAP explanations) — reuse directly for our **Complexity Score (1–10) + Reason Code** requirement.
   - `RouterAgent` (Open Policy Agent / policy-as-code routing) — reuse for our **Filter Node (policy checks)**.
   - `ComplianceAgent` (PII detection, audit logging) — reuse for our **Bias & Fairness Guardrail** and audit trail.
   - `DecisionSupportAgent` (RAG-powered next actions) — adapt for the **Manual assignment (non-STP)** checklist / decision support step.
   - Also reuse its stack: FastAPI backend, PostgreSQL + Redis, OPA for policy-as-code, ChromaDB for RAG, Prometheus/Grafana for monitoring, React + TypeScript dashboard.

2. **https://github.com/IBM/chuk-mcp-solver** — a Model Context Protocol (MCP) server wrapping Google OR-Tools CP-SAT. Use its **`solve_assignment_problem`** high-level API as the core of our **Optimization Node (Smart Allocation Matrix)**: it natively supports skill matching, agent capacity limits, and load-balancing objectives, which map 1:1 onto matching underwriters by specialization, authority limit, and queue depth. Its **`solve_scheduling_problem`** API can also be used for SLA-aware prioritization if time allows. Integrate this as an MCP tool call from our backend agent rather than reimplementing constraint solving.

3. **https://github.com/Anshumaan657/CoverOps-AI** (live demo: cover-ops-ai.vercel.app) — a functional MVP for commercial insurance intake that follows almost the exact same shape as our flow: `intake form + document upload → extract fields, score risk, flag missing info, suggest follow-ups → human review (approve/reject/request-more-info) → audit log`. Reuse these specific pieces:
   - **Missing-field detection + auto-generated follow-up questions** — use this to upgrade our Filter/OCR check step (Phase 1, step 3) beyond a simple pass/fail: list exactly which fields are missing and auto-draft the follow-up request to the customer.
   - **`CaseDetailClient.tsx`-style "AI decision trace"** (inputs, risk factors, missing fields, confidence reason, which engine produced the result) — reuse this UI pattern directly for our **Explainability requirement** (Reason Code + policy pass/fail display).
   - **Audit log of system/AI/human actions** — reuse directly for the "view case detail & audit log" bullet in our Manual assignment step.
   - **`lib/mock-ai.ts` deterministic fallback pattern** — **critical, adopt this as a hard requirement** (see §7). The whole system must run on rule-based deterministic logic when no live LLM API is available, so the hackathon demo never breaks due to API quota/network issues.
   - Tech stack note: CoverOps AI is a single Next.js 16 + TypeScript project (frontend + API routes together), Gemini for live AI, localStorage for demo persistence, Supabase-ready schema for later). This is a **faster path to a working demo** than the heavier FastAPI+OPA+Postgres+Redis stack from Claims-Triage-AI — consider building AI-UD as a Next.js app for speed, and only call out to chuk-mcp-solver (via MCP) from an API route for the matching/optimization step.

Where a reference repo's license/scope doesn't fit, reimplement the same *pattern* (agent responsibility split, request/response schema) rather than copying code verbatim.

### Language/stack constraint: full JavaScript/TypeScript

Build the whole project in JavaScript/TypeScript (Next.js full-stack, per Option B in §6). This is fully compatible with the repos above:
- **Claims-Triage-AI** is Python (FastAPI/XGBoost/SHAP/OPA) — its Python code cannot be imported directly. Reuse only its *architecture* (agent split, reason-code style, policy-as-code idea) and reimplement in TypeScript. Skip real SHAP (Python-only); generate the "confidence reason" via LLM structured output instead, same as CoverOps-AI does. Skip real OPA/Rego; implement the 8 named policies as plain TypeScript functions driven by a declarative JSON rule config, to keep the "policy-as-code" spirit without adding a second runtime.
- **chuk-mcp-solver** is a Python/OR-Tools service, but it's exposed as an MCP server with a public hosted endpoint (`https://solver.chukai.io/mcp`). Call it from the Next.js backend via the official `@modelcontextprotocol/sdk` npm package — this keeps the project's own code 100% JS/TS; the Python only runs on IBM's hosted server, not in this repo. If avoiding external network calls entirely is preferred, implement a small greedy/constraint-lite matching function in TypeScript instead — demo-scale case/underwriter counts don't need a full CP-SAT solver.
- **CoverOps-AI** is already 100% TypeScript/Next.js — no adaptation needed, reuse directly.

**Clone CoverOps-AI locally as a read-only reference** (its README alone doesn't show the actual prompt engineering in `lib/gemini-ai.ts`, the validation schema in `lib/validation.ts`, the fallback logic in `lib/mock-ai.ts`, or the `CaseDetailClient.tsx` UI structure — all needed for real adaptation):
```bash
git clone https://github.com/Anshumaan657/CoverOps-AI.git reference/coverops-ai
```
Keep it in a `reference/` folder, not as a project dependency — read and adapt code from it, don't import it directly (MIT licensed, so reuse is permitted; keep attribution if copying substantial chunks verbatim).

## 3. Business problem

New insurance applications enter a `PENDING` queue. Today, an operations manager manually reviews and assigns each case, causing a 24–48 hour delay, uneven workload across underwriters, and mismatches (e.g., a complex medical case assigned to a junior underwriter). AI-UD must ingest each case, score it, and auto-assign it to the optimal underwriter within minutes — with a safe fallback to human review when the model isn't confident or no qualified underwriter is available.

## 4. End-to-end flow to implement

**Phase 1 — Submission** (actor: customer/agent, web or mobile)
1. Customer/agent creates and submits a new application (web/mobile form).
2. On submission, case status is set to `PENDING` and enters the queue.

**Phase 2 — AI processing** (actor: system, no human in the loop)
3. **Data Ingestion Engine** — pulls structured data (age, sum assured, occupation) and unstructured data (medical history, disclosures) from the Core Admin System and Document/EHR repository (including OCR output for scanned docs). No AI/ML here — pure data aggregation via API/webhook.
4. **Complexity Classifier (Component A)** — ML classification model outputs a **Complexity Score 1–10** (Low 1–3 / Medium 4–7 / High 8–10) plus a human-readable **Reason Code** (SHAP feature importance or rule-based explanation).
5. **NER Specialization Extractor (Component B)** — runs in parallel with step 4. Extracts medical/financial entities from unstructured text and maps them to underwriter specialization tags (e.g., "Myocardial Infarction" → `Cardiology`).
6. **Filter Node — Policy checks (Component C, part 1)** — filters the underwriter pool against these named policies:
   - Authority Limit (UW authority ≥ sum assured)
   - Specialization (matches NER output)
   - STP Eligibility (score band determines straight-through-processing eligibility)
   - Workload Balancing (queue depth cap)
   - SLA Priority (time remaining on SLA)
   - Availability (exclude DND/offline underwriters)
   - Bias & Fairness Guardrail (strip zip code, nationality, and other demographic fields before matching)
   - Escalation Policy (trigger fallback if no one qualifies)
7. **Optimization Node — Smart Allocation Matrix (Component C, part 2)** — from the filtered candidate pool, select the single best underwriter using a constraint-satisfaction/optimization solver (**use chuk-mcp-solver's `solve_assignment_problem`**), optimizing in this priority order: lowest queue depth → closest specialization match → tightest SLA.
8. **Consolidated result** — branches into:
   - **STP path**: score 1–3, high-confidence match — auto-assign, no human review.
   - **Manual path**: score 4–10 or low-confidence/ambiguous match — route to underwriter for manual review.

**Phase 3 — Assignment & review** (actor: underwriter / ops manager)
9. **Auto-assignment (STP)** — system writes `Assignee_ID`, no further action needed.
10. **Manual assignment (non-STP)** — underwriter performs: reclassification (if needed), review checklist, views case detail + audit log, makes final decision. Underwriter can click **"Request AI Re-routing"** if they believe the AI misjudged complexity — this sends the case back to step 7 for re-matching and logs feedback for model retraining.
11. **Escalation / Pool Queue** — if the Filter Node (step 6) finds no qualifying underwriter (e.g., score 10 but all seniors are busy/offline), the case is placed in a Pool Queue and the Operations Manager is alerted for manual override.
12. **Resolve & notify** — once decided, resolve the case and notify both the underwriter's dashboard and the customer (Notification Center integration).

## 5. Core components to build (map 1:1 to the flow above)

| # | Component | Reference to reuse |
|---|---|---|
| 1 | Submission API + case state machine (`PENDING` → assigned → resolved) | Claims-Triage-AI's FastAPI case model |
| 2 | Data Ingestion Engine (aggregation only, no AI) | — |
| 3 | Complexity Classifier + Reason Code | Claims-Triage-AI `RiskScorerAgent` (XGBoost + SHAP) |
| 3b | Missing-field detection + auto follow-up question generation (Phase 1 OCR/completeness check) | CoverOps-AI missing-info + follow-up logic |
| 4 | NER Specialization Extractor | Claims-Triage-AI `ClassifierAgent` pattern (swap domain labels to medical specialties) |
| 5 | Filter Node (8 named policies as policy-as-code rules) | Claims-Triage-AI `RouterAgent` + OPA |
| 6 | Optimization Node (constraint-based matching) | chuk-mcp-solver `solve_assignment_problem` via MCP |
| 7 | Bias & Fairness Guardrail / PII stripping / audit trail | Claims-Triage-AI `ComplianceAgent` + CoverOps-AI audit log pattern |
| 8 | Manual review UI + checklist + "Request AI Re-routing" | Claims-Triage-AI `DecisionSupportAgent` + React dashboard |
| 9 | Escalation / Pool Queue + Ops Manager alert | — |
| 10 | Notification integration (mocked is fine for prototype) | — |
| 11 | Explainability: every assignment decision must show its Reason Code + which policies passed/failed, via an "AI decision trace" view (inputs, risk factors, missing fields, confidence reason, which engine produced the result) | Claims-Triage-AI SHAP output + CoverOps-AI `CaseDetailClient.tsx` pattern |
| 12 | Deterministic fallback mode — the whole pipeline must produce a valid (rule-based) result even with no live LLM/API access | CoverOps-AI `lib/mock-ai.ts` pattern |

## 6. Suggested tech stack

**Option A — full microservice stack (higher fidelity, more setup time):**
- **Backend**: Python, FastAPI (async), Pydantic models for every request/response
- **AI/ML**: XGBoost or fine-tuned BERT for the classifier; spaCy or an LLM-based NER for entity extraction; SHAP for explainability
- **Matching/optimization**: chuk-mcp-solver as an MCP tool (`solve_assignment_problem`)
- **Policy engine**: Open Policy Agent (OPA) for the 8 named policies, policy-as-code (Rego)
- **Data**: PostgreSQL (case data, audit log), Redis (queue/cache)
- **Frontend**: React + TypeScript dashboard
- **Observability**: structured logs + a basic metrics endpoint (Prometheus-compatible if time allows)

**Option B — single Next.js app (faster to a working demo, recommended given hackathon time limits):**
- Next.js 16 + TypeScript + Tailwind, frontend and API routes in one project (follow CoverOps-AI's structure)
- LLM calls (classifier + NER) go through a structured-output call (e.g., Gemini or Claude) with strict JSON schema validation, same pattern as `lib/gemini-ai.ts`
- **Mandatory**: a deterministic rule-based fallback module (same role as `lib/mock-ai.ts`) that produces valid Complexity Score / NER tags / policy results with zero external API calls, so the demo never breaks
- Call chuk-mcp-solver's `solve_assignment_problem` from a server-side API route for the Optimization Node
- Local persistence via localStorage for the demo (Supabase/Postgres-ready schema for later, per CoverOps-AI's approach)

Pick Option B unless the team specifically needs the OPA/Postgres/Redis production-grade pieces for the demo.

## 7. Deliverables

1. A runnable backend exposing REST endpoints for: submit case, run classification, run matching, get case status, manual override, request re-routing.
2. A minimal frontend/dashboard to demo the flow end-to-end (submit a sample case → see it scored → see it assigned or escalated).
3. At least 3 seeded demo scenarios: (a) clean low-complexity case → STP auto-assign, (b) medium-complexity case needing specialist match, (c) high-complexity case with no available senior UW → escalation to Pool Queue.
4. A short README explaining how each of the 3 reference repos was used/adapted.
5. Every automated decision must return a Reason Code and the list of policies checked (pass/fail) — this is a hard requirement, not optional, since it will be demoed to hackathon mentors/judges.
6. The system must keep working with zero live external AI API calls (deterministic fallback mode) — verify this by demoing once with the API key removed.
7. Phase 1 completeness check must list specific missing fields and show an auto-drafted follow-up message, not just a generic pass/fail.

## 8. Non-goals for the prototype

- No production-grade auth/security hardening needed — mock or simplify where reasonable.
- No real OCR/EHR integration required — stub with sample JSON payloads.
- No need to implement time-window/pickup-delivery features from chuk-mcp-solver's routing API — only the assignment API is in scope.
