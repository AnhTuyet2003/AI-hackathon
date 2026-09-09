import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { UnderwritingCase } from "./types";

// Process-local demo integrity key. Restarting the server requires resubmitting old cases.
const globalKey = globalThis as typeof globalThis & { aiUdSigningKey?: string };
const key =
  globalKey.aiUdSigningKey ??
  (globalKey.aiUdSigningKey = randomBytes(32).toString("hex"));

function digest(c: UnderwritingCase) {
  const { snapshotSignature: _sig, ...body } = c;
  return createHmac("sha256", key).update(JSON.stringify(body)).digest("hex");
}

export function signCase(c: UnderwritingCase) {
  return { ...c, snapshotSignature: digest(c) };
}

export function verifyCase(c: UnderwritingCase) {
  if (
    !c ||
    typeof c.snapshotSignature !== "string" ||
    !/^[a-f0-9]{64}$/.test(c.snapshotSignature) ||
    !timingSafeEqual(
      Buffer.from(c.snapshotSignature, "hex"),
      Buffer.from(digest(c), "hex"),
    )
  )
    throw new Error(
      "Case snapshot is unverified or changed. Resubmit the original documents to create a current case.",
    );
}
