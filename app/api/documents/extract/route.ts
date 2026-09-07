import { NextResponse } from "next/server";
import { extractDocuments } from "@/lib/document-ingest";
import { parseUploadedFiles } from "@/lib/validation";

// Runs OCR / vision extraction the moment documents are attached on the Submit page, so the
// submitter can reconcile the extracted fields against what they typed BEFORE the case is scored.
// This endpoint never merges or scores -- it just returns what the documents say.
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const files = parseUploadedFiles((payload as { files?: unknown })?.files);
  if (files.error) {
    return NextResponse.json({ error: files.error }, { status: 400 });
  }

  const extractions = await extractDocuments(files.data);
  return NextResponse.json({ extractions });
}
