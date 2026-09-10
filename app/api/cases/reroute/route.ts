import { NextResponse } from "next/server";
import { rerouteCase } from "@/lib/pipeline";
import { signCase, verifyCase } from "@/lib/case-signature";
import type { UnderwritingCase } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      case: UnderwritingCase;
      underwriterId?: string;
      note?: string;
      reason?: string;
      excludeUnderwriterId?: string;
    };
    verifyCase(body.case);
    const updated = await rerouteCase(
      body.case,
      body.reason || "Requested rerouting",
      body.excludeUnderwriterId,
    );
    return NextResponse.json({ case: signCase(updated) });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid case action.",
      },
      { status: 400 },
    );
  }
}
