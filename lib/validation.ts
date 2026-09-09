import type { ApplicationInput } from "./types";
import type { UploadedFile } from "./document-ingest";

const PRODUCT_LINES = [
  "Individual Life",
  "Group Life",
  "Critical Illness",
  "Health",
];

const ALLOWED_UPLOAD_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "text/plain",
];
const MAX_UPLOAD_FILES = 4;
const MAX_UPLOAD_BYTES = 4_000_000;

export function parseUploadedFiles(value: unknown): {
  data: UploadedFile[];
  error?: string;
} {
  if (value == null) return { data: [] };
  if (!Array.isArray(value))
    return { data: [], error: "Uploaded files payload is malformed." };

  if (value.length > MAX_UPLOAD_FILES)
    return { data: [], error: "At most four documents are allowed." };
  const files: UploadedFile[] = [];
  for (const item of value.slice(0, MAX_UPLOAD_FILES)) {
    if (!isRecord(item))
      return { data: [], error: "Invalid document payload." };
    const name = cleanText(item.name, 180);
    const mimeType = cleanText(item.mimeType, 100).toLowerCase();
    const dataBase64 =
      typeof item.dataBase64 === "string" ? item.dataBase64.trim() : "";
    if (
      !name ||
      !dataBase64 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64) ||
      dataBase64.length % 4 !== 0
    )
      return { data: [], error: "Document bytes are missing or invalid." };
    if (!ALLOWED_UPLOAD_MIME.includes(mimeType)) {
      return {
        data: [],
        error: `Unsupported file type "${mimeType || "unknown"}". Upload PDF, DOCX, JPG, or PNG.`,
      };
    }
    // base64 decodes to ~3/4 of its own length.
    if (dataBase64.length * 0.75 > MAX_UPLOAD_BYTES) {
      return {
        data: [],
        error: `"${name}" is larger than the 4 MB per-file limit.`,
      };
    }
    const ocrText =
      typeof item.ocrText === "string"
        ? item.ocrText.replace(/\s+/g, " ").trim().slice(0, 20_000)
        : undefined;
    const documentSessionId =
      typeof item.documentSessionId === "string"
        ? item.documentSessionId.trim().slice(0, 120)
        : undefined;
    const sourceFileHash =
      typeof item.sourceFileHash === "string"
        ? item.sourceFileHash.trim().slice(0, 128)
        : undefined;
    const createdAt =
      typeof item.createdAt === "string"
        ? item.createdAt.trim().slice(0, 40)
        : undefined;
    files.push({
      name,
      mimeType,
      dataBase64,
      ocrText,
      documentSessionId,
      sourceFileHash,
      createdAt,
    });
  }
  return { data: files };
}

export function parseApplicationInput(value: unknown): {
  data?: ApplicationInput;
  error?: string;
} {
  if (!isRecord(value)) return { error: "Invalid application payload." };

  const applicantName = cleanText(value.applicantName, 120);
  const age = cleanNumber(value.age, 0, 120);
  const sumAssured = cleanNumber(value.sumAssured, 0, 100_000_000);
  const occupation = cleanText(value.occupation, 120);
  const productLine = cleanChoice(
    value.productLine,
    PRODUCT_LINES,
    "Individual Life",
  );
  const medicalHistory = cleanText(value.medicalHistory, 2000);
  const disclosures = cleanText(value.disclosures, 2000);
  const documents = cleanStringArray(value.documents, 12, 180);

  if (!applicantName) return { error: "Applicant name is required." };
  if (!Number.isFinite(age) || !Number.isFinite(sumAssured))
    return { error: "Numeric application fields are invalid." };

  return {
    data: {
      applicantName,
      age,
      sumAssured,
      occupation,
      productLine,
      medicalHistory,
      disclosures,
      documents,
    },
  };
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function cleanChoice(value: unknown, choices: string[], fallback: string) {
  return typeof value === "string" && choices.includes(value)
    ? value
    : fallback;
}

function cleanNumber(value: unknown, min: number, max: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return NaN;
  return numeric < min || numeric > max ? NaN : Math.round(numeric);
}

function cleanStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
) {
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
