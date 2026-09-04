import { NextResponse } from "next/server";
import { rejectToPoolQueue } from "@/lib/pipeline";
import type { UnderwritingCase } from "@/lib/types";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid reject payload." }, { status: 400 });
  }

  const body = payload as { case?: UnderwritingCase; reason?: string };
  if (!body.case?.id) return NextResponse.json({ error: "Missing case snapshot." }, { status: 400 });

  const updated = rejectToPoolQueue(body.case, body.reason || "");
  return NextResponse.json({ case: updated });
}
