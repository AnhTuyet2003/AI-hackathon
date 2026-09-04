import { NextResponse } from "next/server";
import { rerouteCase } from "@/lib/pipeline";
import type { UnderwritingCase } from "@/lib/types";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid re-routing payload." }, { status: 400 });
  }

  const body = payload as { case?: UnderwritingCase; reason?: string; excludeUnderwriterId?: string };
  if (!body.case?.id) return NextResponse.json({ error: "Missing case snapshot." }, { status: 400 });

  try {
    const updated = await rerouteCase(body.case, body.reason || "Underwriter requested AI re-routing.", body.excludeUnderwriterId);
    return NextResponse.json({ case: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Re-routing failed." }, { status: 400 });
  }
}
