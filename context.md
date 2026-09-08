# context.md — AI-Underwriting Dispatcher (AI-UD)

Tài liệu ngữ cảnh cho người/agent tiếp nhận dự án. Tóm tắt *what / why / how* của prototype, không lặp lại chi tiết code đã có trong `README.md` và `AI-UD_Build_Prompt.md`.

---

## 1. Dự án là gì

Prototype cho **GIF AI Hackathon 2026 — Track 1: BFSI AI Agent**.

**AI-UD** đọc một hồ sơ yêu cầu bảo hiểm nhân thọ mới, chấm **điểm phức tạp (1–10)**, trích xuất
thực thể chuyên khoa y tế/tài chính (NER), lọc pool thẩm định viên (underwriter) theo 8 chính sách,
rồi **tự động phân bổ case cho underwriter tối ưu trong vài giây** — thay cho quy trình gán tay
24–48 giờ hiện tại. Có nhánh an toàn: khi mô hình không đủ tự tin hoặc không có underwriter đủ điều
kiện, case rơi vào **Pool Queue** để Ops Manager can thiệp.

Nguồn yêu cầu: `AI-UD_Build_Prompt.md` (bản đặc tả build đầy đủ) + sơ đồ luồng end-to-end đính kèm
hackathon.

## 2. Bài toán nghiệp vụ

Hồ sơ mới vào hàng đợi `PENDING`. Hiện tại Ops Manager review và gán tay từng case → chậm 24–48h,
tải lệch giữa các underwriter, và sai khớp năng lực (case y tế phức tạp rơi vào underwriter junior).
AI-UD phải ingest → score → auto-assign trong vài phút, có fallback về review thủ công.

## 3. Stack & ràng buộc

- **Một app Next.js 16 + TypeScript + Tailwind** (frontend + API routes chung một project) — Option B
  của build spec. Không có backend riêng, không DB.
- **Toàn bộ code là JS/TS.** Các repo tham chiếu Python chỉ được mượn *kiến trúc/pattern*, không import.
- **Persistence demo**: `localStorage` phía client (`lib/local-store.ts`, key `ai-ud-cases-v3`).
  Seed dữ liệu dựng đồng bộ lúc load module, không cần network.
- **LLM live**: Google Gemini qua `@google/genai` (`lib/gemini-ai.ts`) — *tùy chọn*.
- **Solver**: `chuk-mcp-solver` của IBM gọi qua MCP (`@modelcontextprotocol/sdk`,
  `StreamableHTTPClientTransport`) tới endpoint hosted `https://solver.chukai.io/mcp`.
- **Yêu cầu cứng — deterministic fallback**: toàn pipeline phải cho ra kết quả hợp lệ (rule-based)
  khi **không có** `GEMINI_API_KEY` và khi solver không truy cập được. Đây là trạng thái mặc định
  của repo.

### Scripts (`package.json`)

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy dev server `http://localhost:3000` |
| `npm run build` | `next build --webpack` |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit -p tsconfig.typecheck.json` |
| `npm test` | `tsx test/verify.mjs` — replay toàn bộ fixtures qua pipeline thật, assert `expected` |
| `npm run make-docs` | Dựng lại `test/fixtures/documents/` |

### Biến môi trường (`.env.local`)

- `GEMINI_API_KEY` — trống ⇒ chạy fallback rule-based (mặc định).
- `MCP_SOLVER_URL` — mặc định `https://solver.chukai.io/mcp` nếu không set.

## 4. Luồng end-to-end (map với build spec §4)

```
Phase 1  Submission        → status PENDING, vào hàng đợi
Phase 2  AI processing (không có người):
  step 2  Document Ingestion Engine   OCR + trích field từ tài liệu đính kèm (không AI/ML — tổng hợp dữ liệu)
  step 4  Complexity Classifier (A)   score 1–10 + band low/med/high + Reason Code + driverFactors
  step 5  NER Specialization (B)       thực thể → specialization tag (vd "Myocardial Infarction" → Cardiology)
  step 6  Filter Node (C.1)            lọc pool theo 8 chính sách (policy-as-code)
  step 7  Optimization Node (C.2)      chuk-mcp-solver chọn 1 underwriter tốt nhất
  step 8  Consolidated result          rẽ nhánh STP / MANUAL / ESCALATED
Phase 3  Assignment & review:
  step 9   STP    → ghi Assignee_ID, không cần người
  step 10  MANUAL → underwriter review checklist, xem audit, quyết định; có nút "Request AI Re-routing"
  step 11  ESCALATED → Pool Queue, Ops Manager override
  step 12  Resolve & notify
```

Orchestration nằm ở [lib/pipeline.ts](lib/pipeline.ts): `runIntakePipeline` (chạy full), `rerouteCase`
(chạy lại *chỉ* Optimization Node), `applyOverride`, `resolveCase`, `rejectToPoolQueue`.

### Quy tắc quyết định (`decide()` trong pipeline.ts)

- Không có underwriter đủ điều kiện → `POOL_QUEUE` / `ESCALATED`.
- Band `low` + có match → `ASSIGNED_STP` / `STP`.
- Band `medium`/`high` + có match → `ASSIGNED_MANUAL` / `MANUAL`.

## 5. Cấu trúc thư mục

```
app/
  page.tsx                 Dashboard (admin)
  submit/page.tsx          Submit Application (user + admin)
  pool-queue/page.tsx      Pool Queue / Ops override (admin)
  audit/page.tsx           Audit Log toàn hệ thống (admin)
  cases/[id]/page.tsx      Case detail + AI decision trace (admin)
  api/cases/process        POST — chạy runIntakePipeline
  api/cases/reroute        POST — Request AI Re-routing
  api/cases/override       POST — Ops Manager gán tay
  api/cases/reject         POST — underwriter từ chối match → Pool Queue
  api/cases/resolve        POST — chốt case
  api/documents/extract    POST — OCR tài liệu lúc đính kèm (Gemini hoặc stub)
components/                Client components (AppShell, DashboardClient, SubmitClient,
                           CaseDetailClient, PoolQueueClient, AuditClient, RoleSwitcher, …)
lib/                       Toàn bộ logic (xem §6)
test/                      Fixtures + verify.mjs (nguồn dữ liệu demo duy nhất — app cũng đọc từ đây)
reference/coverops-ai/     Repo tham chiếu clone read-only (KHÔNG phải dependency)
```

## 6. Module chính trong `lib/`

| File | Vai trò |
|---|---|
| `types.ts` | Toàn bộ type: `ApplicationInput`, `UnderwritingCase`, `ComplexityResult`, `NERResult`, `Underwriter`, `PolicyCheck`, `MatchResult`, `AuditEvent`, các type Document Ingestion / Reconciliation |
| `pipeline.ts` | Orchestration (§4). Bắt lỗi Gemini → fallback đồng bộ sang `mock-ai.ts`, ghi audit `Gemini unavailable -- deterministic fallback used` |
| `gemini-ai.ts` | Đường LLM live cho Component A + B, một structured-output call. **Throw** khi bất kỳ lỗi nào để caller fallback |
| `mock-ai.ts` | Engine deterministic zero-API: `scoreComplexity`, `extractEntities`, `detectMissingFields` (+ auto-draft follow-up message). Luôn phải cho kết quả hợp lệ |
| `policies.ts` | 8 chính sách Filter Node dạng hàm TS + config khai báo. Gating cứng: Authority Limit, Specialization, Workload Balancing, Availability. Informational: STP Eligibility, SLA Priority, Bias & Fairness Guardrail. Escalation Policy xử lý ở tầng orchestration |
| `matching.ts` | Optimization Node. `evaluateAndRank` (core đồng bộ, cũng dùng bởi seed), `runMatching` (gọi solver, fallback greedy). Thứ tự ưu tiên: queue depth thấp nhất → specialization overlap cao nhất → SLA còn ít nhất |
| `mcp-solver.ts` | Wrap `solve_assignment_problem` của chuk-mcp-solver qua MCP. 1 case = 1 task, underwriter đủ điều kiện = agents, cost matrix mã hóa thứ tự ưu tiên. Lỗi bất kỳ → caller dùng greedy |
| `underwriters.ts` | `underwriterRegistry` mẫu (John Doe, Tom Becker, Sarah Jenkins, các tier Medical…) + `queueLoadCapByTier` |
| `document-ingest.ts` | Server-side: OCR + auto-merge tài liệu vào `ApplicationInput` (đường direct-API / seed) |
| `reconcile.ts` | Helper thuần chia sẻ server/client, không import `@google/genai` (an toàn cho browser bundle). Biến `DocumentExtraction` thành gợi ý để người submit tự đối chiếu |
| `validation.ts` | Parse/validate `ApplicationInput` và file upload (MIME cho phép: pdf/png/jpeg/txt, tối đa 4 file, 4MB) |
| `seed.ts` | Dashboard state ban đầu, dựng đồng bộ deterministic. Input lấy từ `test/fixtures/applications.ts` |
| `local-store.ts` | Đọc/ghi `localStorage` (`ai-ud-cases-v3`); fallback về `seedCases` khi SSR/chưa có dữ liệu |
| `session.ts` | RBAC demo client-side (xem §8) |

## 7. Hai đường tài liệu vào pipeline

`runIntakePipeline(input, opts)` nhận `opts`:

- **`opts.files`** — upload thô: pipeline gọi `runDocumentIngestion` để OCR + **auto-merge** (giá trị
  tài liệu thắng), mọi thay đổi ghi audit. Dùng bởi direct-API caller và seed offline.
- **`opts.extractions`** (+ `opts.reconciliation`) — tài liệu đã được OCR bởi `/api/documents/extract`
  và người submit **đã đối chiếu tay** trên trang Submit (reconcile panel). Pipeline tin `input`
  as-is, chỉ ghi lại những gì đã xảy ra (`mode: "reconciled"`).

## 8. Phân quyền (RBAC demo — `lib/session.ts`)

Không có auth thật. "Role" chỉ là giá trị trong `localStorage` (`ai-ud-role`), lật bởi `RoleSwitcher`
ở sidebar. Enforcement client-side trong `<AppShell>`: route không được phép → redirect về landing.

| Role | Truy cập |
|---|---|
| `user` | Chỉ `/submit` |
| `admin` | `/`, `/pool-queue`, `/audit`, `/cases/*` **và** `/submit` |

## 9. Explainability (yêu cầu cứng của hackathon)

Mọi quyết định tự động phải trả về **Reason Code** + danh sách policy pass/fail. Hiển thị qua "AI
decision trace" trong [components/CaseDetailClient.tsx](components/CaseDetailClient.tsx): inputs,
driver factors, missing fields, engine nào tạo kết quả (`gemini` | `fallback`, `mcp-solver` |
`greedy-fallback`), từng `PolicyCheck` với `detail`. Audit events lưu chronological (cũ → mới), sort
descending lúc hiển thị.

## 10. Kịch bản demo (seed lúc load — `lib/seed.ts`)

1. **Clean / STP** — complexity thấp (1–3), auto-assign, không review người.
2. **Specialist match** — complexity medium có disclosure Cardiology → route tới đúng underwriter
   (Sarah Jenkins) vượt cả specialization tag lẫn authority limit.
3. **High complexity / escalation** — score 8–10, Sum Assured cao; cả hai underwriter tier Medical
   không khả dụng (một DND, một quá workload cap) → không ai qua gating → Pool Queue.

Nút "Fill demo case" trên `/submit` tái hiện 3 kịch bản này *live qua full pipeline* (bao gồm gọi
solver.chukai.io thật), không chỉ replay seed tĩnh.

## 11. Testing

- `npm test` → `test/verify.mjs`: chạy ~22 fixture (`test/fixtures/applications.ts`) qua pipeline
  thật, assert nhánh `expected`. Ép `GEMINI_API_KEY=""` và trỏ MCP solver tới địa chỉ chết ⇒ test
  chỉ exercise engine rule-based + greedy, chạy offline vài giây, exit 1 nếu lệch.
- `test/fixtures/` là **nguồn dữ liệu demo/test duy nhất** — app runtime cũng đọc từ đây
  (`lib/seed.ts`, `components/SubmitClient.tsx` qua `submitPresets`).
- `test/fixtures/documents/*.pdf` + `*.txt` twins để test Document Ingestion trên `/submit`.
- Coverage fixtures: đủ mọi `CaseStatus`, `DecisionPath`, complexity band, specialization
  (Cardiology / Endocrinology / Oncology / Complex Medical), lý do escalation, hồ sơ thiếu field,
  4 product line.

## 12. Ba repo tham chiếu được dùng thế nào

- **[Anshumaan657/CoverOps-AI](https://github.com/Anshumaan657/CoverOps-AI)** — clone read-only vào
  `reference/coverops-ai/`. Nguồn của toàn bộ cấu trúc project: shape App Router, pattern
  `lib/types.ts` / `mock-ai.ts` / `local-store.ts` / `validation.ts`, shape request/response
  `IntakeInput → API route → InsuranceCase`, và **pattern deterministic fallback** (`mock-ai.ts`).
  UI "AI Decision Trace" trong `CaseDetailClient.tsx` tái dùng trực tiếp làm khung panel
  Explainability.
- **[aurelius-in/Claims-Triage-AI](https://github.com/aurelius-in/Claims-Triage-AI)** — Python, chỉ
  đọc qua GitHub, **không clone**. Mượn *kiến trúc*: pipeline agent tuần tự (`lib/pipeline.ts`),
  shape `{score, reasonCode, driverFactors}` kiểu `RiskScorerAgent` cho Component A, ý tưởng
  policy-as-code của `RouterAgent` (OPA/Rego) reimplement thành hàm TS + config khai báo trong
  `lib/policies.ts` (không thêm runtime OPA).
- **[IBM/chuk-mcp-solver](https://github.com/IBM/chuk-mcp-solver)** — gọi live qua MCP tới endpoint
  hosted, tool `solve_assignment_problem` (`lib/mcp-solver.ts`). Lỗi bất kỳ → greedy matcher local
  cùng thứ tự ưu tiên, Optimization Node không bao giờ block demo vì mạng.

## 13. Non-goals (nằm ngoài phạm vi, theo build spec)

- Không auth/security production.
- Không tích hợp OCR/EHR thật (tài liệu stub bằng chuỗi tên file / text twin).
- Không dùng tính năng time-window / pickup-delivery scheduling của chuk-mcp-solver — chỉ assignment API.
- Không SHAP thật (Python-only) — "confidence reason" sinh qua structured output của LLM.

## 14. Trạng thái git hiện tại

- Branch: `feat/doc-ingestion-rbac-tests` (nhánh chính để mở PR: `main`).
- Commit gần nhất: `ddf7c31 Add document ingestion, reconcile flow, role gating, and test fixtures`.
