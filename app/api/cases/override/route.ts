import { NextResponse } from "next/server";
import { applyOverride } from "@/lib/pipeline";
import type { UnderwritingCase } from "@/lib/types";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid override payload." }, { status: 400 });
  }

  const body = payload as { case?: UnderwritingCase; underwriterId?: string; note?: string };
  if (!body.case?.id) return NextResponse.json({ error: "Missing case snapshot." }, { status: 400 });
  if (!body.underwriterId) return NextResponse.json({ error: "underwriterId is required." }, { status: 400 });

  const updated = applyOverride(body.case, body.underwriterId, body.note || "Manual override from Pool Queue.");
  return NextResponse.json({ case: updated });
}
