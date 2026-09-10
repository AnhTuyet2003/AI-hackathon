import type { ApplicationInput } from "./types";
import { applicationOnly } from "./evidence-text";

export type DocumentFieldDecision = {
  choice: "doc" | "mine";
  from: string;
  to: string;
  source: string;
};

/** Restore only document-owned scalar values; preserve subsequent manual edits. */
export function resetDocumentForm(
  previous: ApplicationInput,
  decisions: Record<string, DocumentFieldDecision>,
): ApplicationInput {
  const next = {
    ...previous,
    documents: [],
    medicalHistory: applicationOnly(previous.medicalHistory),
    disclosures: applicationOnly(previous.disclosures),
  };
  for (const [key, d] of Object.entries(decisions)) {
    if (
      d.choice === "doc" &&
      ["age", "sumAssured", "occupation", "productLine"].includes(key) &&
      String(previous[key as keyof ApplicationInput]) === d.to
    ) {
      (next as unknown as Record<string, unknown>)[key] =
        key === "age" || key === "sumAssured"
          ? Number(d.from)
          : d.from === "(empty)"
            ? ""
            : d.from;
    }
  }
  return next;
}
