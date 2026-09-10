/** Shared conservative evidence handling; these rules are heuristics, not clinical probabilities. */
export function affirmativeText(text: string): string {
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .filter(
      (s) =>
        !/\b(?:no|not|denies|without|negative for|not applicable|not included|not provided|unavailable|unknown|n\/a)\b/i.test(
          s,
        ),
    )
    .join(" ");
}
export function applicationOnly(text: string) {
  return text
    .replace(
      /\[DOCUMENT_EVIDENCE_START:[^\]]+\][\s\S]*?\[DOCUMENT_EVIDENCE_END:[^\]]+\]/g,
      "",
    )
    .trim();
}
export function realDate(value: string) {
  if (!value.trim()) return false;
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
  if (
    iso &&
    (!Number.isFinite(Date.parse(iso[1])) ||
      new Date(iso[1]).toISOString().slice(0, 10) !== iso[1])
  )
    return false;
  return Number.isFinite(Date.parse(value));
}
export const usable = (v: unknown) =>
  typeof v === "string"
    ? !!v.trim() &&
      !/^(?:not available|unavailable|not provided|not included|unknown|n\/a|none|null|na|-1|-7|-8|-9|-15)$/i.test(
        v.trim(),
      )
    : v != null;
