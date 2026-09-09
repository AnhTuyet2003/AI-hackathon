import { NextResponse } from "next/server";
import { extractDocuments } from "@/lib/document-ingest";
import { runIntakePipeline } from "@/lib/pipeline";
import { parseExtractions, parseReconciliation } from "@/lib/reconcile";
import { parseApplicationInput, parseUploadedFiles } from "@/lib/validation";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid application payload." }, { status: 400 });
  }

  const parsed = parseApplicationInput(payload);
  if (!parsed.data) {
    return NextResponse.json({ error: parsed.error || "Invalid application payload." }, { status: 400 });
  }

  const body = (payload ?? {}) as { files?: unknown; extractions?: unknown; reconciliation?: unknown; documentSessionId?: unknown };
  const documentSessionId = typeof body.documentSessionId === "string" ? body.documentSessionId : undefined;

  const files = parseUploadedFiles(body.files);
  if (files.error) {
    return NextResponse.json({ error: files.error }, { status: 400 });
  }

  // The browser uses the extraction endpoint for immediate reconciliation, but also sends the
  // original files here. Re-extract on the server when available so a modified client cannot
  // fabricate medical evidence and create a passing quality result.
  const extractions = parseExtractions(body.extractions);
  if (files.data.length) {
    const serverExtractions = await extractDocuments(files.data);
    const reconciliation = parseReconciliation(body.reconciliation);
    const generatedCase = await runIntakePipeline(parsed.data, {
      extractions: serverExtractions,
      reconciliation,
      documentSessionId
    });
    return NextResponse.json({ case: generatedCase });
  }

  // Compatibility path for direct callers that already have sanitized extractions but cannot
  // resend the original file. This path is intentionally not used by the normal submit UI.
  if (extractions.length) {
    if (documentSessionId && extractions.some((extraction) => extraction.documentSessionId !== documentSessionId)) {
      return NextResponse.json({ error: "Document evaluation session does not match the selected document." }, { status: 409 });
    }
    const reconciliation = parseReconciliation(body.reconciliation);
    const generatedCase = await runIntakePipeline(parsed.data, { extractions, reconciliation, documentSessionId });
    return NextResponse.json({ case: generatedCase });
  }

  // Fallback path: raw files, OCR + auto-merge server-side.
  const generatedCase = await runIntakePipeline(parsed.data, { files: files.data, documentSessionId });
  return NextResponse.json({ case: generatedCase });
}
