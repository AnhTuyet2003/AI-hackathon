import { NextResponse } from "next/server";
import { runIntakePipeline } from "@/lib/pipeline";
import { parseReconciliation } from "@/lib/reconcile";
import { parseApplicationInput, parseUploadedFiles } from "@/lib/validation";
import { signCase } from "@/lib/case-signature";

export async function POST(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid application payload." },
      { status: 400 },
    );
  }
  const parsed = parseApplicationInput(value);
  if (!parsed.data)
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  const body = value as Record<string, unknown>;
  const files = parseUploadedFiles(body.files);
  if (files.error)
    return NextResponse.json({ error: files.error }, { status: 400 });
  if (
    body.extractions &&
    (!Array.isArray(body.extractions) || body.extractions.length > 0) &&
    !files.data.length
  )
    return NextResponse.json(
      {
        error:
          "Submit original files; client-provided extractions cannot authorize assignment.",
      },
      { status: 400 },
    );
  if (
    files.data.some(
      (f) =>
        !f.documentSessionId || f.documentSessionId !== body.documentSessionId,
    )
  )
    return NextResponse.json(
      { error: "Document session does not match current files." },
      { status: 409 },
    );
  try {
    const c = await runIntakePipeline(parsed.data, {
      files: files.data,
      reconciliation: parseReconciliation(body.reconciliation),
      documentSessionId: body.documentSessionId as string,
      verified: !files.data.some((f) => f.ocrText),
    });
    return NextResponse.json({ case: signCase(c) });
  } catch {
    return NextResponse.json(
      {
        error:
          "Document verification failed. Re-select the current files and retry.",
      },
      { status: 400 },
    );
  }
}
