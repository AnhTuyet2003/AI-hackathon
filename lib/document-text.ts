import { inflateRawSync, inflateSync } from "node:zlib";
import type { UploadedFile } from "./document-ingest";

export type DocumentTextResult = {
  text: string;
  readable: boolean;
  problems: string[];
  source:
    | "provided-ocr"
    | "plain-text"
    | "pdf-text"
    | "docx-text"
    | "unreadable";
};

/**
 * Small dependency-free text layer for the demo. It handles selectable PDFs produced by common
 * report generators, DOCX word/document.xml, plain text, and caller-provided OCR text. Scanned
 * PDFs without OCR remain unreadable offline and are intentionally routed to human review.
 */
export function extractDocumentText(file: UploadedFile): DocumentTextResult {
  if (file.ocrText?.trim()) {
    return {
      text: cleanText(file.ocrText),
      readable: true,
      problems: [],
      source: "provided-ocr",
    };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(file.dataBase64, "base64");
  } catch {
    return unreadable("The uploaded content could not be decoded.");
  }
  if (!bytes.length)
    return unreadable("The document contained no readable bytes.");

  if (file.mimeType === "text/plain") {
    const text = cleanText(bytes.toString("utf8"));
    return text
      ? { text, readable: true, problems: [], source: "plain-text" }
      : unreadable("The text document was empty.");
  }
  if (
    file.mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(file.name)
  ) {
    return extractDocxText(bytes);
  }
  if (file.mimeType === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return extractPdfText(bytes);
  }

  return unreadable(
    "Image content requires OCR. Supply verified text or enable live extraction.",
  );
}

function extractPdfText(bytes: Buffer): DocumentTextResult {
  const decodedStreams: string[] = [];
  const source = bytes.toString("latin1");
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(source))) {
    const raw = Buffer.from(match[1], "latin1");
    for (const candidate of [
      raw,
      tryInflate(raw, true),
      tryInflate(raw, false),
    ]) {
      if (!candidate) continue;
      const text = candidate.toString("latin1");
      if (/\b(BT|Tj|TJ|Tf)\b/.test(text)) decodedStreams.push(text);
    }
  }

  const text = cleanText(decodedStreams.flatMap(extractPdfStrings).join(" "));
  if (text) return { text, readable: true, problems: [], source: "pdf-text" };
  return unreadable(
    "No selectable text was found. OCR is required for this scanned or image-only PDF.",
    "unreadable",
  );
}

function tryInflate(raw: Buffer, rawDeflate: boolean) {
  try {
    return rawDeflate ? inflateRawSync(raw) : inflateSync(raw);
  } catch {
    return null;
  }
}

function extractPdfStrings(stream: string): string[] {
  const out: string[] = [];
  const stringPattern = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = stringPattern.exec(stream)))
    out.push(decodePdfString(match[1]));

  const arrayPattern = /\[([\s\S]*?)\]\s*TJ/g;
  while ((match = arrayPattern.exec(stream))) {
    const values = match[1].match(/\(((?:\\.|[^\\)])*)\)/g) ?? [];
    out.push(...values.map((value) => decodePdfString(value.slice(1, -1))));
  }
  return out;
}

function decodePdfString(value: string) {
  return value
    .replace(/\\([\\()])/g, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\([0-7]{1,3})/g, (_, octal: string) =>
      String.fromCharCode(parseInt(octal, 8)),
    );
}

function extractDocxText(bytes: Buffer): DocumentTextResult {
  const files = readZipEntries(bytes);
  const documentXml = files.get("word/document.xml");
  if (!documentXml)
    return unreadable(
      "The DOCX document did not contain word/document.xml.",
      "docx-text",
    );
  const text = cleanText(
    documentXml
      .toString("utf8")
      .replace(/<w:tab\s*\/?>(?=\S)/g, " ")
      .replace(/<w:br\s*\/?>(?=\S)/g, "\n")
      .replace(/<[^>]+>/g, " "),
  );
  return text
    ? { text, readable: true, problems: [], source: "docx-text" }
    : unreadable("The DOCX document contained no readable text.", "docx-text");
}

function readZipEntries(bytes: Buffer) {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    if (bytes.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = bytes
      .subarray(nameStart, nameStart + nameLength)
      .toString("utf8");
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    try {
      const content =
        method === 0
          ? compressed
          : method === 8
            ? inflateRawSync(compressed)
            : null;
      if (content) entries.set(name, content);
    } catch {
      // Skip a corrupt entry and let the caller report that the document is unreadable.
    }
    offset = dataStart + compressedSize;
  }
  return entries;
}

function cleanText(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

function unreadable(
  problem: string,
  source: DocumentTextResult["source"] = "unreadable",
): DocumentTextResult {
  return { text: "", readable: false, problems: [problem], source };
}
