import { NextResponse } from "next/server";
import { runIntakePipeline } from "@/lib/pipeline";
import { parseApplicationInput } from "@/lib/validation";

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

  const generatedCase = await runIntakePipeline(parsed.data);
  return NextResponse.json({ case: generatedCase });
}
