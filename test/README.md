# test/

Fixtures and checks for the AI-Underwriting Dispatcher. This folder is the single source of truth
for demo/test data — the running app reads from it too.

## Layout

| Path | What |
|---|---|
| `fixtures/applications.ts` | ~22 curated application requests (`applicationFixtures`) covering every pipeline branch, each with an `expected` outcome. Also exports `generateApplications` (deterministic background volume), `submitPresets` (the Submit form's demo buttons), and `demoIngestionByKey` (canned OCR results for two seed cases). |
| `fixtures/documents/` | Supporting-document files (`*.pdf` + `*.txt` twins) for testing the Document Ingestion Engine on the Submit page. |
| `make-documents.mjs` | Regenerates `fixtures/documents/`. |
| `verify.mjs` | Runs every fixture through the real intake pipeline and asserts the `expected` branch. |

## Who consumes what

- `lib/seed.ts` → `applicationFixtures` + `generateApplications` + `demoIngestionByKey` (initial dashboard state).
- `components/SubmitClient.tsx` → `submitPresets`.
- `test/verify.mjs` → `applicationFixtures` + `lib/pipeline.ts`.

## Commands

Treatment-category evaluation tests live in `care-routing.test.ts`. They verify required-field
gating, independent category evidence, strict single-category routing, model-output validation,
data separation and metric accounting. See [the evaluation guide](../evaluation/care/README.md).

```bash
npm test            # run the Jest fixture suite with assertions (exit 1 on drift)
npm run test:coverage # run Jest with coverage reporting
npm run make-docs   # (re)build fixtures/documents/
```

The Jest suite forces Gemini into fallback mode and mocks the MCP solver boundary, so it exercises
the deterministic rule-based pipeline fully offline without depending on network timing. The
legacy `verify.mjs` script still forces `GEMINI_API_KEY=""` and points the MCP solver at a dead
address for a console-only replay.

## Coverage

`applicationFixtures` includes at least one request for each:

- **Status**: `ASSIGNED_STP`, `ASSIGNED_MANUAL`, `POOL_QUEUE`, `RESOLVED`
- **Decision path**: `STP`, `MANUAL`, `ESCALATED`
- **Complexity band**: `low`, `medium`, `high`
- **Specialization**: `Cardiology`, `Endocrinology`, `Oncology`, `Complex Medical`
- **Escalation reasons**: multi-morbidity, Sum Assured over every authority limit, catastrophic Sum Assured
- **Incomplete application**: missing disclosures / missing history+documents / blank occupation
- **Product lines**: Individual Life, Group Life, Critical Illness, Health

## Manual document test

On `/submit` (as `user` or `admin`), attach files from `fixtures/documents/`:

- `doctor-notes.pdf` → Cardiology findings, non-smoker, meds
- `medical-questionnaire.pdf` → Type 2 Diabetes (Endocrinology), BMI
- `doctor-notes-oncology.pdf` → Oncology, in remission
- `financial-statement.pdf` / `hnw-financial-dossier.pdf` → income + Sum Assured (drives a reconcile suggestion)
- `application-form.pdf` / `id-verification.pdf` → age, occupation, marital status

OCR runs on attach; the reconcile panel then asks you to align any differences before submit.
# Label Review checks

`care-review.test.ts` covers independent review requirements, exact-source evidence, approval and correction rules, unresolved field disagreements, backup validation, and reviewed-label ingestion into the evaluator. These are software checks, not domain review of the synthetic labels.
