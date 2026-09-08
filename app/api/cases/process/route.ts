import { NextResponse } from "next/server";
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

  const body = (payload ?? {}) as { files?: unknown; extractions?: unknown; reconciliation?: unknown };

  // Preferred path: the Submit page OCR'd the documents up front and the submitter reconciled the
  // fields, so it sends the extraction results (not raw files) plus a reconciliation log.
  const extractions = parseExtractions(body.extractions);
  if (extractions.length) {
    const reconciliation = parseReconciliation(body.reconciliation);
    const generatedCase = await runIntakePipeline(parsed.data, { extractions, reconciliation });
    return NextResponse.json({ case: generatedCase });
  }

  // Fallback path: raw files, OCR + auto-merge server-side.
  const files = parseUploadedFiles(body.files);
  if (files.error) {
    return NextResponse.json({ error: files.error }, { status: 400 });
  }

  const generatedCase = await runIntakePipeline(parsed.data, { files: files.data });
  return NextResponse.json({ case: generatedCase });
}
