"use client";

import { useEffect, useRef, useState } from "react";
import { careFixtures } from "@/evaluation/care/fixtures";
import {
  CARE_CATEGORIES,
  decideCareRoute,
  type CareEvidence,
  type EvidenceState,
} from "@/lib/care-routing";
import {
  REVIEW_FIELDS,
  REVIEW_STORAGE_KEY,
  agreesWithReference,
  blankReview,
  completeReview,
  makeReviewPack,
  parseReviewPack,
  reviewAnswer,
  type LabelReview,
  type ReviewDraft,
  type ReviewPack,
  type ReviewStatus,
} from "@/lib/care-review";
import { FormSection, RecordHeader } from "@/components/ModelDriven";

const statusNames: Record<ReviewStatus, string> = {
  draft: "Draft",
  independent: "Judgement saved",
  approved: "Approved",
  corrected: "Corrected",
  discussion: "Needs discussion",
};
const fieldNames: Record<string, string> = {
  submissionId: "Submission ID",
  submissionUse: "Submission purpose",
  memberId: "Member ID",
  policyId: "Policy ID",
  providerId: "Provider ID",
  serviceDate: "Service date",
  documents: "Documents",
};
const stateNames = {
  supported: "Supported",
  not_supported: "Not supported",
  uncertain: "Uncertain",
};
const reasonNames: Record<string, string> = {
  REQUIRED_FIELDS_FAILED: "Required fields failed",
  MULTIPLE_CATEGORIES: "Multiple categories",
  EVIDENCE_UNCERTAIN: "Uncertain evidence",
  CATEGORY_NOT_FOUND: "No category found",
  ONE_CATEGORY_CONFIRMED: "One category confirmed",
};
const finished = (r: LabelReview) =>
  r.status === "approved" || r.status === "corrected";

export function LabelReviewClient() {
  const [reviews, setReviews] = useState<LabelReview[]>([]);
  const [ready, setReady] = useState(false);
  const [split, setSplit] = useState<"development" | "holdout">("development");
  const [id, setId] = useState("C001");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingImport, setPendingImport] = useState<ReviewPack | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cases = careFixtures.filter((f) => f.split === split);
  const fixture = cases.find((f) => f.id === id) ?? cases[0];
  const current =
    reviews.find((r) => r.id === fixture.id) ?? blankReview(fixture);
  const index = cases.indexOf(fixture);
  const reviewed = cases.filter((f) =>
    reviews.some((r) => r.id === f.id && finished(r)),
  ).length;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REVIEW_STORAGE_KEY);
      if (saved)
        setReviews(parseReviewPack(JSON.parse(saved), careFixtures).reviews);
    } catch {
      setError(
        "Saved reviews could not be read. They have not been overwritten. Restore a valid backup or resolve browser storage before continuing.",
      );
    }
    setReady(true);
  }, []);

  function store(next: LabelReview[], checkConflict = true) {
    try {
      if (checkConflict) {
        const saved = localStorage.getItem(REVIEW_STORAGE_KEY);
        const stored = saved
          ? parseReviewPack(JSON.parse(saved), careFixtures).reviews
          : [];
        if (JSON.stringify(stored) !== JSON.stringify(reviews))
          throw new Error(
            "Reviews changed in another tab. Reload this page before continuing.",
          );
      }
      localStorage.setItem(
        REVIEW_STORAGE_KEY,
        JSON.stringify(makeReviewPack(next)),
      );
      setReviews(next);
      setError("");
      return true;
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes("another tab")
          ? e.message
          : "Changes could not be saved. Check browser storage or restore a valid backup. Your previous saved reviews are preserved.",
      );
      return false;
    }
  }

  function save(record: LabelReview, message = "Draft saved in this browser.") {
    const next = reviews.some((r) => r.id === record.id)
      ? reviews.map((r) => (r.id === record.id ? record : r))
      : [...reviews, record];
    if (store(next)) setNotice(message);
  }
  function edit(patch: Partial<ReviewDraft>) {
    save({
      ...current,
      draft: { ...current.draft, ...patch },
      status: "draft",
      updatedAt: new Date().toISOString(),
    });
  }
  function evidenceEdit(
    category: string,
    patch: Partial<ReviewDraft["evidence"][string]>,
  ) {
    edit({
      evidence: {
        ...current.draft.evidence,
        [category]: { ...current.draft.evidence[category], ...patch },
      },
    });
  }
  function independent() {
    try {
      const answer = reviewAnswer(current.draft, fixture);
      const now = new Date().toISOString();
      save(
        {
          ...current,
          independent: JSON.parse(JSON.stringify(answer)),
          independentSavedAt: now,
          status: "independent",
          updatedAt: now,
        },
        "Independent judgement saved. You can now reveal the proposed labels.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function complete(status: "approved" | "corrected" | "discussion") {
    try {
      save(
        completeReview(current, fixture, status),
        `${statusNames[status]}. Review saved in this browser.`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function download() {
    const blob = new Blob(
      [JSON.stringify(makeReviewPack(reviews), null, 2) + "\n"],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `care-label-reviews-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      "Review export downloaded. It includes drafts, independent judgements and final decisions.",
    );
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000)
        throw new Error("Choose a review export smaller than 2 MB.");
      setPendingImport(
        parseReviewPack(JSON.parse(await file.text()), careFixtures),
      );
      setError("");
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "The file is not valid review JSON."
          : (e as Error).message,
      );
    }
  }
  function navigate(nextId: string) {
    setId(nextId);
    setError("");
    setNotice("");
  }

  let preview =
    "Choose all three labels and confirm the required fields to preview routing.";
  try {
    const answer = reviewAnswer(current.draft, fixture);
    const decision = decideCareRoute(fixture.input, answer.evidence);
    preview = answer.missingFields.length
      ? "Pool Queue · Required fields failed"
      : `${decision.category ?? "Pool Queue"} · ${reasonNames[decision.reason] ?? decision.reason}`;
    if (!answer.missingFields.length && decision.missingFields.length)
      preview =
        "Your field assessment differs from the rule. Flag this case for discussion.";
  } catch {
    /* Incomplete forms have no routing preview. */
  }

  if (!ready) return <p className="p-6">Loading saved reviews…</p>;
  return (
    <>
      <RecordHeader
        recordType="Evaluation workspace"
        title="Label Review"
        subtitle="Review treatment submissions independently, then compare with the proposed labels."
        facts={[
          {
            label: `${split} cases completed`,
            value: `${reviewed} / ${cases.length}`,
          },
          { label: "Source", value: "Synthetic examples" },
        ]}
      />
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-muted">
            Changes save in this browser. Export a backup to keep or share your
            work. Reviewer names are self-entered; these cases are not real
            insurer submissions.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="ghost-button"
              onClick={() => fileInput.current?.click()}
            >
              Restore review file
            </button>
            <input
              ref={fileInput}
              aria-label="Restore review file"
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="primary-button"
              disabled={!reviews.length}
              onClick={download}
            >
              Export reviews ({reviews.length})
            </button>
          </div>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded border border-red-200 bg-red-50 p-3 text-udred"
          >
            {error}
          </p>
        )}
        <p
          role="status"
          aria-live="polite"
          className="min-h-5 text-[12px] text-muted"
        >
          {notice ||
            "Start with the 12 development cases. Proposed labels stay hidden until you record your judgement."}
        </p>
        {pendingImport && (
          <section
            className="shell-card space-y-3 p-4"
            aria-label="Confirm restore"
          >
            <p>
              This file contains {pendingImport.reviews.length} reviews.
              Restoring replaces{" "}
              {
                pendingImport.reviews.filter((r) =>
                  reviews.some((existing) => existing.id === r.id),
                ).length
              }{" "}
              existing reviews with matching case IDs. Other reviews stay
              available.
            </p>
            <button
              className="primary-button mr-2"
              onClick={() => {
                const next = [
                  ...reviews.filter(
                    (r) =>
                      !pendingImport.reviews.some(
                        (incoming) => incoming.id === r.id,
                      ),
                  ),
                  ...pendingImport.reviews,
                ];
                if (store(next, false)) {
                  setPendingImport(null);
                  setNotice("Reviews restored and saved in this browser.");
                }
              }}
            >
              Confirm restore
            </button>
            <button
              className="ghost-button"
              onClick={() => setPendingImport(null)}
            >
              Cancel
            </button>
          </section>
        )}
        <details className="shell-card p-4">
          <summary className="cursor-pointer font-semibold">
            Labelling guide and required-field rules
          </summary>
          <div className="mt-3 space-y-2 leading-relaxed">
            <p>
              Label the current submitted treatment, not unrelated history.
              Inpatient needs explicit admission; an overnight stay alone is
              insufficient. Outpatient includes explicit outpatient, office,
              ambulatory, wellness and urgent-care services. Dental needs actual
              dental care; dental alone does not establish Outpatient.
            </p>
            <p>
              Emergency or observation without resolved admission status is
              uncertain. Dental care during inpatient admission supports both
              categories. Mark all applicable categories; do not force one
              choice.
            </p>
            <p>
              Check every field shown below and at least one readable document
              with a unique ID. IDs cannot be blank, unknown, N/A, null, none,
              or reserved values −1, −7, −8, −9, −15. Purpose must be claim or
              preauthorization. Dates need a real day in YYYY-MM-DD format.
              Presence checks do not verify policy eligibility.
            </p>
            <p>
              Supported and uncertain labels require exact document quotes. Not
              supported means the document has no affirmative current-service
              evidence. With no source document, use Not supported and mark
              Documents as missing.
            </p>
            <p>
              Missing fields, zero or multiple categories, and unresolved
              uncertainty go to Pool Queue. The rules are a draft: use Needs
              discussion for policy disagreements. Finish labels for every case
              in a set before evaluating it.
            </p>
          </div>
        </details>
        <div className="shell-card flex flex-wrap items-end gap-3 p-4">
          <label className="field-label">
            Review set
            <select
              className="field-input"
              value={split}
              onChange={(e) => {
                const next = e.target.value as typeof split;
                setSplit(next);
                navigate(careFixtures.find((f) => f.split === next)!.id);
              }}
            >
              <option value="development">Development · 12 cases</option>
              <option value="holdout">Holdout · 25 cases</option>
            </select>
          </label>
          <label className="field-label flex-1">
            Case
            <select
              className="field-input min-w-48"
              value={fixture.id}
              onChange={(e) => navigate(e.target.value)}
            >
              {cases.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id} ·{" "}
                  {reviews.find((r) => r.id === f.id)
                    ? statusNames[reviews.find((r) => r.id === f.id)!.status]
                    : "Not started"}
                </option>
              ))}
            </select>
          </label>
          <button
            className="ghost-button"
            disabled={index === 0}
            onClick={() => navigate(cases[index - 1].id)}
          >
            Previous
          </button>
          <button
            className="ghost-button"
            disabled={index === cases.length - 1}
            onClick={() => navigate(cases[index + 1].id)}
          >
            Next case
          </button>
        </div>
        {split === "holdout" && (
          <p className="rounded border border-amber-200 bg-amber-50 p-3">
            Holdout cases are reserved for the final comparison. Review their
            labels independently, and do not use them to improve the model
            prompt.
          </p>
        )}
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            <FormSection title={`${fixture.id} · Submission details`}>
              <dl className="divide-y divide-line">
                {REVIEW_FIELDS.filter((f) => f !== "documents").map((field) => (
                  <div key={field} className="grid grid-cols-2 gap-2 py-2">
                    <dt className="text-muted">{fieldNames[field]}</dt>
                    <dd className="break-words font-medium">
                      {fixture.input[field]?.trim() || "Not supplied"}
                    </dd>
                  </div>
                ))}
              </dl>
            </FormSection>
            <FormSection title="Source documents">
              <p className="mb-3 text-muted">
                Read the evidence below. Copy the exact words into your category
                evidence.
              </p>
              {!fixture.input.documents.length && (
                <p className="rounded bg-slate-50 p-4">No document supplied.</p>
              )}
              {fixture.input.documents.map((doc) => (
                <article
                  key={doc.id}
                  className="mb-3 rounded border border-line bg-slate-50 p-4"
                >
                  <h3 className="mb-2 font-semibold">Document {doc.id}</h3>
                  <p className="whitespace-pre-wrap text-[15px] leading-7">
                    {doc.text}
                  </p>
                </article>
              ))}
            </FormSection>
            {current.referenceViewedAt && (
              <FormSection title="Proposed labels · authored reference">
                <p className="mb-3 text-muted">
                  {fixture.scenario}. Your first judgement remains saved
                  separately.
                </p>
                <EvidenceSummary evidence={fixture.goldEvidence} />
                <p className="mt-3">
                  Required-field failures:{" "}
                  {fixture.expected.missingFields
                    .map((f) => fieldNames[f])
                    .join(", ") || "None"}
                  .
                </p>
                <p className="mt-2 font-semibold">
                  {fixture.expected.category ?? "Pool Queue"} ·{" "}
                  {reasonNames[fixture.expected.reason]}
                </p>
              </FormSection>
            )}
            {current.independent && (
              <details className="shell-card p-4">
                <summary className="cursor-pointer font-semibold">
                  Your saved independent judgement
                </summary>
                <div className="mt-3">
                  <EvidenceSummary evidence={current.independent.evidence} />
                  <p className="mt-2">
                    Required-field failures:{" "}
                    {current.independent.missingFields
                      .map((f) => fieldNames[f])
                      .join(", ") || "None"}
                    .
                  </p>
                  <p className="mt-2">
                    Reviewer: {current.independent.reviewer}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap">
                    {current.independent.notes}
                  </p>
                </div>
              </details>
            )}
          </div>
          <FormSection
            title={
              current.referenceViewedAt
                ? "Compare and finalize your review"
                : "Your independent judgement"
            }
          >
            <p className="mb-4 text-muted">
              Status: <strong>{statusNames[current.status]}</strong>.{" "}
              {current.referenceViewedAt
                ? "Editing a completed review returns it to Draft until you finalize it again."
                : "Choose your own labels before viewing the proposal."}
            </p>
            <label className="field-label mb-4">
              Reviewer name
              <input
                className="field-input"
                autoComplete="name"
                value={current.draft.reviewer}
                onChange={(e) => edit({ reviewer: e.target.value })}
              />
            </label>
            <fieldset className="mb-5 space-y-2 rounded border border-line p-3">
              <legend className="px-1 font-semibold">Required fields</legend>
              <p className="text-muted">
                Select each missing or invalid field. Leave all unchecked if
                every field passes.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {REVIEW_FIELDS.map((field) => (
                  <label key={field} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={current.draft.missingFields.includes(field)}
                      onChange={(e) =>
                        edit({
                          missingFields: e.target.checked
                            ? [...current.draft.missingFields, field]
                            : current.draft.missingFields.filter(
                                (f) => f !== field,
                              ),
                        })
                      }
                    />
                    {fieldNames[field]}
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 border-t border-line pt-2 font-medium">
                <input
                  type="checkbox"
                  checked={current.draft.fieldsChecked}
                  onChange={(e) => edit({ fieldsChecked: e.target.checked })}
                />
                I checked all required fields
              </label>
            </fieldset>
            {CARE_CATEGORIES.map((category) => {
              const evidence = current.draft.evidence[category];
              return (
                <fieldset
                  key={category}
                  className="mb-4 space-y-3 rounded border border-line p-3"
                >
                  <legend className="px-1 font-semibold">{category}</legend>
                  <label className="field-label">
                    {category} label
                    <select
                      className="field-input"
                      value={evidence.state}
                      onChange={(e) =>
                        evidenceEdit(category, {
                          state: e.target.value as EvidenceState | "",
                          citations:
                            e.target.value === "not_supported" ||
                            !e.target.value
                              ? []
                              : evidence.citations.length
                                ? evidence.citations
                                : [
                                    {
                                      documentId:
                                        fixture.input.documents[0]?.id ?? "",
                                      quote: "",
                                    },
                                  ],
                        })
                      }
                    >
                      <option value="">Choose a label…</option>
                      {Object.entries(stateNames).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {evidence.citations.map((citation, i) => (
                    <div
                      key={i}
                      className="space-y-2 border-t border-line pt-2"
                    >
                      <label className="field-label">
                        {category} document {i + 1}
                        <select
                          className="field-input"
                          value={citation.documentId}
                          onChange={(e) =>
                            evidenceEdit(category, {
                              citations: evidence.citations.map((q, j) =>
                                i === j
                                  ? { ...q, documentId: e.target.value }
                                  : q,
                              ),
                            })
                          }
                        >
                          <option value="">Choose document…</option>
                          {fixture.input.documents.map((d) => (
                            <option value={d.id} key={d.id}>
                              {d.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label">
                        {category} exact quote {i + 1}
                        <textarea
                          rows={2}
                          className="field-input"
                          value={citation.quote}
                          onChange={(e) =>
                            evidenceEdit(category, {
                              citations: evidence.citations.map((q, j) =>
                                i === j ? { ...q, quote: e.target.value } : q,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        className="text-[12px] text-udblue underline"
                        onClick={() =>
                          evidenceEdit(category, {
                            citations: evidence.citations.filter(
                              (_, j) => j !== i,
                            ),
                          })
                        }
                      >
                        Remove quote {i + 1}
                      </button>
                    </div>
                  ))}
                  {(evidence.state === "supported" ||
                    evidence.state === "uncertain") && (
                    <button
                      className="ghost-button"
                      onClick={() =>
                        evidenceEdit(category, {
                          citations: [
                            ...evidence.citations,
                            {
                              documentId: fixture.input.documents[0]?.id ?? "",
                              quote: "",
                            },
                          ],
                        })
                      }
                    >
                      Add {category} quote
                    </button>
                  )}
                </fieldset>
              );
            })}
            <label className="field-label">
              Review notes
              <textarea
                rows={3}
                className="field-input"
                placeholder="Explain a correction, uncertainty or policy question."
                value={current.draft.notes}
                onChange={(e) => edit({ notes: e.target.value })}
              />
            </label>
            <div className="my-4 rounded border border-blue-100 bg-blue-50 p-3">
              <p className="eyebrow mb-1">Routing from your labels</p>
              <p>{preview}</p>
            </div>
            {!current.independent && (
              <button className="primary-button" onClick={independent}>
                Save independent judgement
              </button>
            )}
            {current.independent && !current.referenceViewedAt && (
              <button
                className="primary-button"
                onClick={() =>
                  save(
                    { ...current, referenceViewedAt: new Date().toISOString() },
                    "Proposed labels revealed. Compare and finalize your review.",
                  )
                }
              >
                Reveal proposed labels
              </button>
            )}
            {current.referenceViewedAt && (
              <div className="flex flex-wrap gap-2">
                <button
                  className="primary-button"
                  onClick={() => complete("approved")}
                >
                  Approve labels
                </button>
                <button
                  className="ghost-button"
                  onClick={() => complete("corrected")}
                >
                  Save correction
                </button>
                <button
                  className="ghost-button"
                  onClick={() => complete("discussion")}
                >
                  Needs discussion
                </button>
              </div>
            )}
            {current.referenceViewedAt && current.independent && (
              <p className="mt-3 text-[12px] text-muted">
                {agreesWithReference(current.independent, fixture)
                  ? "Your independent labels agreed with the proposal."
                  : "Your independent labels differed from the proposal. Review the evidence before finalizing."}
              </p>
            )}
          </FormSection>
        </div>
      </div>
    </>
  );
}

function EvidenceSummary({ evidence }: { evidence: CareEvidence }) {
  return (
    <div className="space-y-3">
      {CARE_CATEGORIES.map((category) => (
        <div key={category}>
          <p>
            <strong>{category}</strong> · {stateNames[evidence[category].state]}
          </p>
          {evidence[category].citations.map((q, i) => (
            <blockquote
              className="mt-1 border-l-2 border-line pl-3 text-muted"
              key={i}
            >
              {q.documentId}: “{q.quote}”
            </blockquote>
          ))}
        </div>
      ))}
    </div>
  );
}
