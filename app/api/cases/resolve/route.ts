import { NextResponse } from "next/server";
import { resolveCase } from "@/lib/pipeline";
import type { UnderwritingCase } from "@/lib/types";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid resolve payload." }, { status: 400 });
  }

  const body = payload as { case?: UnderwritingCase; note?: string };
  if (!body.case?.id) return NextResponse.json({ error: "Missing case snapshot." }, { status: 400 });

  const updated = resolveCase(body.case, body.note || "");
  return NextResponse.json({ case: updated });
}
