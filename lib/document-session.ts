import type { DocumentSession } from "./types";

export function createDocumentSession(sourceFileName: string, sourceFileHash?: string): DocumentSession {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { documentSessionId: `doc-${random}`, sourceFileName, sourceFileHash, createdAt: new Date().toISOString() };
}

export async function hashBase64(dataBase64: string): Promise<string> {
  const binary = atob(dataBase64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
