import { NextResponse } from "next/server";
import { rejectToPoolQueue } from "@/lib/pipeline";
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
    const updated = await rejectToPoolQueue(body.case, body.reason || "");
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
