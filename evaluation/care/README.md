# Treatment classification evaluation

This workflow establishes a versioned category specification and labelled evaluation set before deciding whether a model needs fine-tuning. It evaluates treatment or preauthorization submissions. It is separate from the application's existing life-insurance purchase and underwriter-assignment flow.

The dataset contains **37 authored synthetic reference cases: 12 development and 25 holdout**. Source cases start as `needs_domain_review`. They are controlled test examples inspired by the dataset findings, not original insurer documents or expert-approved ground truth. Passing these cases does not establish production accuracy.

## Review in the app

Start the app, select the **Admin** demo role, then open **Evaluation → Label Review** (`/label-review`). This uses the existing local demo role switcher; it is not authenticated reviewer access.

1. Start with the Development set. Read the submission details and source documents. Case titles and proposed labels are hidden to reduce bias.
2. Enter your reviewer name. Mark missing or invalid fields, then confirm you checked all required fields.
3. Choose Supported, Not supported or Uncertain for each category. Copy exact quotes from the source and choose the corresponding document for every supported or uncertain category. Multiple quotes are supported.
4. Select **Save independent judgement**, then **Reveal proposed labels**. Your first judgement is preserved separately from subsequent edits.
5. Choose **Approve labels**, **Save correction**, or **Needs discussion**. Corrections and discussion require notes. If your field assessment disagrees with the current validation rule, flag it for discussion; the rule must be resolved before evaluation.
6. Use **Next case**. Progress counts only Approved and Corrected cases. Editing a completed review returns it to Draft until finalized again.
7. Select **Export reviews** to download a JSON backup containing drafts, first judgements, final decisions, reviewer names, timestamps, policy version and source snapshots. **Restore review file** validates the file, previews matching cases that will be replaced, and requires a confirmation click in the app.

Every form change saves to this browser's local storage. Reviews do not sync between browsers, ports or computers. Export regularly; clearing browser data removes local reviews. Storage failures and conflicting writes from another tab are reported instead of silently claiming a save. This is a single-reviewer demo workflow, not a signed or tamper-proof audit system. Imported reviewer identities are self-declared. Proposed labels are hidden in the interface, not protected from developer tools.

To use a completed review export, pass it as reference labels, **not predictions**:

```sh
# Offline: ensure all 12 development reviews are finalized and valid.
npm run evaluate:care -- --reviews /path/to/care-label-reviews.json --split development

# Measure the baseline against the reviewed development labels.
npm run evaluate:care -- --mode gemini --reviews /path/to/care-label-reviews.json --split development
```

The selected set must be fully Approved or Corrected. Missing cases, drafts, discussion cases, duplicate IDs, changed source inputs, incompatible policy versions and invalid evidence are rejected before any model call. Other sets can remain unfinished. The report records the review-file hash and marks the selected references as reviewer-confirmed synthetic labels. Source fixtures are not overwritten. Omit `--reviews` to use the original authored labels.

## Category specification

Policy version: `care-routing-v1-draft`. Model prompt version: `care-evidence-v1`.

The routing unit is the submitted current treatment event, requested treatment in a preauthorization, or an explicitly submitted bundle. Unrelated medical history is outside that unit. An event may support several categories.

| Category | Positive evidence | Insufficient evidence |
|---|---|---|
| Inpatient | Explicit formal inpatient admission for the submitted event; a planned admission in a preauthorization | Hospital name, a past admission, or an overnight stay without admission status |
| Outpatient | Explicit outpatient, office-based medical, ambulatory, wellness or urgent-care service | Absence of an admission alone; a Dental procedure alone |
| Dental | Explicit dental care, including examination, cleaning, filling, root canal or tooth extraction | Unrelated dental history, the word oral alone, or similar substrings such as behavioral |

Office visits, wellness and urgent-care mapping to Outpatient are **draft business choices**. Emergency and observation without resolved setting produce uncertainty about Inpatient and Outpatient. Explicit admission following emergency assessment supports Inpatient; a preceding ER visit does not automatically create a separate Outpatient service.

For every category the classifier must return `supported`, `not_supported`, or `uncertain`. `not_supported` means no affirmative current-service evidence in the supplied documents, not proven clinical absence. A clear Dental-only note with no stated setting may support only Dental. Explicitly illegible or conflicting setting information must remain uncertain.

All supported and uncertain states need exact quotes linked to document IDs. Repeated documents do not increase the number of categories. Source quotes are mechanically checked for existence; their semantic relevance still needs reference labels and human review.

## Required fields for this evaluation

The first gate checks `submissionId`, `submissionUse`, `memberId`, `policyId`, `providerId`, `serviceDate`, and one or more nonempty source documents with unique IDs. The accepted purposes are `claim` and `preauthorization`. Blank identifiers and reserved/unknown placeholders fail. Dates must be real calendar dates with day precision. Month-only MEPS dates are not silently expanded to a day.

These checks validate presence and format only. There is no member, policy or provider registry lookup. Claim amounts, benefit eligibility, admission/discharge documents, category-specific clinical details and reviewer availability belong to later insurer-specific checks. `ONE_CATEGORY_CONFIRMED` means the classification stage succeeded; it does **not** authorize payment or assign an underwriter. The [dataset findings](../../../outputs/dataset-feasibility-20260908/dataset_findings.md) describe the broader proposed field standard.

## Gate order

1. Common required-field failure: Pool Queue with `REQUIRED_FIELDS_FAILED`; the classifier is not invoked.
2. Provider failure or malformed, incomplete or ungrounded output: Pool Queue with `MODEL_UNAVAILABLE` or `MODEL_OUTPUT_INVALID`. No fallback prediction is used in evaluation.
3. Two or three supported categories: Pool Queue with `MULTIPLE_CATEGORIES`.
4. Any unresolved category evidence: Pool Queue with `EVIDENCE_UNCERTAIN`, even if one other category is supported.
5. No supported category: Pool Queue with `CATEGORY_NOT_FOUND`.
6. Exactly one supported category and no uncertainty: return that category with `ONE_CATEGORY_CONFIRMED`.

This preserves the user's no-precedence rule. A Dental procedure during an explicit inpatient admission remains a conflict. Fine-tuning must not train the model to hide it.

## Run the workflow

Run these commands from the app directory with its dependencies installed:

```sh
# Offline: check fixture consistency, quotes, group separation and policy outcomes.
npm run evaluate:care

# Export readable cases for review, inputs and a separate reference-label file.
npm run evaluate:care -- --mode export --split development
npm run evaluate:care -- --mode export --split holdout

# Explicit live baseline; loads GEMINI_API_KEY from the environment or .env.local.
npm run evaluate:care -- --mode gemini --split development

# Run only after the prompt and mapping are frozen for this comparison.
npm run evaluate:care -- --mode gemini --split holdout

# Compare saved predictions from another model against exactly the same cases.
npm run evaluate:care -- --mode predictions --split development --predictions predictions.json
```

The default run makes **no network calls** and reports model accuracy as unavailable. Live runs use the existing Google SDK, a structured JSON response schema, exact-quote validation and a 30-second request timeout. The default model matches the app's configured code default, `gemini-3.1-flash-lite`; override it with `--model` or `CARE_EVAL_MODEL`. Live model availability has not been verified by an API call in this implementation.

Model inputs contain only purpose, service date and document IDs/text. They exclude fixture IDs, scenario names, splits, identities and reference labels. The baseline uses the written specification as system instructions, with no holdout examples in the prompt. Documents are treated as untrusted data, not as instructions.

The export's `commonValidationFailures` is gate metadata for the evaluator. An external classifier should receive only the nested `input` and should run only when the common gate passes. Use the outer `id` solely to associate results. The reference-label file and review guide must not be included in classifier input.

Prediction files are JSON objects keyed by fixture ID, for example:

```json
{
  "C001": {
    "Inpatient": {"state": "supported", "citations": [{"documentId": "D1", "quote": "admitted as an inpatient"}]},
    "Outpatient": {"state": "not_supported", "citations": []},
    "Dental": {"state": "not_supported", "citations": []}
  }
}
```

Supply every case in the selected split that passes common validation. Missing predictions cause an error; cases from a different split are rejected. Reference labels must never be replayed and described as actual model performance.

## Reading the report

Reports go to `evaluation/results/` by default, with a timestamp, model name where applicable, dataset and prompt hashes, and policy/prompt versions. Override the directory using `--output`. Generated build files and reports are excluded from Git.

Metrics distinguish common gate failures, classification attempts and actual provider calls. They include exact decision accuracy, accuracy among classification attempts, auto-route coverage and precision, per-category evidence precision/recall/F1, conflict recall, unknown/uncertain case recall, a route confusion matrix, and Pool Queue counts by reason. Zero-denominator metrics are `null`, not a misleading 100%.

Exact correctness includes the final category, reason, supported/uncertain category sets and common failures. A provider error that sends a known queue case to the queue is **not** counted as a correct classification. Failed predictions also count as missed positive evidence in per-category recall. Inspect `modelFailures` before interpreting a confusion matrix. The command exits nonzero for provider or output failures. Classification mistakes remain measured outcomes because no release threshold has been approved.

## Label review and the fine-tuning decision

Use the Label Review page to confirm each synthetic label against this draft policy, export your decisions, and pass the export with `--reviews` when evaluating. The Markdown review guide is an alternative reading aid; editing it does not update evaluator labels. Actual insurer examples should carry their own provenance and reviewer sign-off; do not relabel these synthetic examples as real data.

Before a production evaluation, add representative anonymized submission documents, reviewer-confirmed missing fields, all applicable category evidence, uncertainty and intended queue reasons. Keep all records for the same person/claim in one partition. The runner checks `groupId` separation, but the dataset curator must assign those groups correctly. Do not derive labels from source filenames, schema names, event-ID suffixes or later payment outcomes.

Use development cases to improve the prompt and mappings. Freeze them before a holdout run; repeated optimization against the holdout makes it development data. The synthetic holdout tests variation, not independent clinical validity. If repeatable interpretation errors remain on representative reviewed cases, compare a tuned model to the unchanged baseline using the same independent test set. Fine-tuning is warranted only by a measured improvement against agreed accuracy, queue-load and cost targets.

References: [MEPS Inpatient](https://meps.ahrq.gov/mepsweb/data_stats/download_data_files_detail.jsp?cboPufNumber=HC-248D), [MEPS Outpatient](https://meps.ahrq.gov/mepsweb/data_stats/download_data_files_detail.jsp?cboPufNumber=HC-248F), [MEPS Dental](https://meps.ahrq.gov/mepsweb/data_stats/download_data_files_detail.jsp?cboPufNumber=HC-248B), [Synthea sample](https://synthetichealth.github.io/synthea-sample-data/downloads/synthea_sample_data_csv_apr2020.zip), [Google structured output SDK example](https://github.com/googleapis/js-genai/blob/main/sdk-samples/generate_content_with_response_schema_accept_json_schema.ts).
