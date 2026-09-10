import { CARE_CATEGORIES, type CareEvidence } from "./care-routing";

export const CARE_CLASSIFIER_VERSION = "care-rules-v1";

/** Infer each category independently. Quotes remain exact source substrings. No filenames or model labels are inputs. */
export function classifyCareDocuments(
  documents: { id: string; text: string }[],
): CareEvidence {
  const result = Object.fromEntries(
    CARE_CATEGORIES.map((c) => [c, { state: "not_supported", citations: [] }]),
  ) as unknown as CareEvidence;
  const add = (
    c: keyof CareEvidence,
    state: "supported" | "uncertain",
    id: string,
    quote: string,
  ) => {
    if (result[c].state === "uncertain") return;
    if (state === "uncertain")
      result[c] = { state, citations: [{ documentId: id, quote }] };
    else {
      result[c].state = state;
      result[c].citations.push({ documentId: id, quote });
    }
  };
  for (const doc of documents) {
    const text = doc.text.split(
      /Copied footer:|ignore previous instructions/i,
    )[0];
    const current = text.match(
      /Current (?:service|submitted service)\b/i,
    )?.index;
    const source = current != null ? text.slice(current) : text;
    const sentences = source.match(/[^.!?\n]+(?:[.!?](?=\s|$)|$)/g) ?? [source];
    let hasAdmission = false;
    for (const raw of sentences) {
      const s = raw.trim();
      if (!s || /^(?:History:|Relevant medical history:)/i.test(s)) continue;
      if (
        /\b(?:history of|in 20(?:0\d|1\d)|NOT APPLICABLE|no tooth|no.*dental|no admission|not admitted|denies)\b/i.test(
          s,
        )
      )
        continue;
      const uncertain =
        /unclear|uncertain|illegible|unreadable|not recorded|not documented|not stated|possible inpatient/i.test(
          s,
        );
      if (uncertain) {
        if (/care setting and treatment details.*unreadable/i.test(s)) {
          for (const c of CARE_CATEGORIES) add(c, "uncertain", doc.id, s);
          continue;
        }
        if (
          /possible inpatient|admission.*(?:unclear|illegible)|inpatient versus outpatient/i.test(
            s,
          )
        ) {
          add("Inpatient", "uncertain", doc.id, s);
          if (!/possible inpatient/i.test(s))
            add("Outpatient", "uncertain", doc.id, s);
          continue;
        }
      }
      if (/\b(?:no|not|denies|without|negative for)\b/i.test(s)) continue;
      if (
        /\binpatient\b|điều trị nội trú|nhập viện.*nội trú/i.test(s) &&
        !uncertain
      ) {
        add("Inpatient", "supported", doc.id, s);
        hasAdmission = true;
      }
      const dental =
        /\bdental\b|tooth extraction|extraction of (?:wisdom )?tooth|root canal|lấy cao răng|đánh bóng răng/i.test(
          s,
        );
      if (dental) add("Dental", "supported", doc.id, s);
      if (
        /\boutpatient\b|khám ngoại trú|\bambulatory\b|urgent[- ]care|wellness visit|office[- ]based medical|outpatient clinic|clinic consultation/i.test(
          s,
        ) &&
        !uncertain &&
        !/not a separate outpatient/i.test(s)
      )
        add("Outpatient", "supported", doc.id, s);
    }
    if (
      !hasAdmission &&
      result.Inpatient.state !== "supported" &&
      /emergency department|observation stay|kept overnight/i.test(source)
    ) {
      const q = sentences
        .find((s) =>
          /emergency department|observation stay|kept overnight/i.test(s),
        )!
        .trim();
      add("Inpatient", "uncertain", doc.id, q);
      add("Outpatient", "uncertain", doc.id, q);
    }
  }
  return result;
}
