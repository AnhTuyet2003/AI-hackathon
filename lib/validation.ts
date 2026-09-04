import type { ApplicationInput } from "./types";

const PRODUCT_LINES = ["Individual Life", "Group Life", "Critical Illness", "Health"];

export function parseApplicationInput(value: unknown): { data?: ApplicationInput; error?: string } {
  if (!isRecord(value)) return { error: "Invalid application payload." };

  const applicantName = cleanText(value.applicantName, 120);
  const age = cleanNumber(value.age, 0, 120);
  const sumAssured = cleanNumber(value.sumAssured, 0, 100_000_000);
  const occupation = cleanText(value.occupation, 120);
  const productLine = cleanChoice(value.productLine, PRODUCT_LINES, "Individual Life");
  const medicalHistory = cleanText(value.medicalHistory, 2000);
  const disclosures = cleanText(value.disclosures, 2000);
  const documents = cleanStringArray(value.documents, 12, 180);

  if (!applicantName) return { error: "Applicant name is required." };
  if (!Number.isFinite(age) || !Number.isFinite(sumAssured)) return { error: "Numeric application fields are invalid." };

  return {
    data: { applicantName, age, sumAssured, occupation, productLine, medicalHistory, disclosures, documents }
  };
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function cleanChoice(value: unknown, choices: string[], fallback: string) {
  return typeof value === "string" && choices.includes(value) ? value : fallback;
}

function cleanNumber(value: unknown, min: number, max: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return NaN;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function cleanStringArray(value: unknown, maxItems: number, maxItemLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanText(item, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
