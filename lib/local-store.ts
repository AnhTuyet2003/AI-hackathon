"use client";

import { seedCases } from "./seed";
import type { AuditEvent, UnderwritingCase } from "./types";

// Bump the suffix whenever the seed shape/content changes so browsers that already cached an older
// demo dataset pick up the new one instead of being stuck on stale localStorage.
const CASES_KEY = "ai-ud-cases-v4-integrated";

export function getCases(): UnderwritingCase[] {
  if (typeof window === "undefined") return seedCases;
  const saved = window.localStorage.getItem(CASES_KEY);
  if (!saved) {
    window.localStorage.setItem(CASES_KEY, JSON.stringify(seedCases));
    return seedCases;
  }
  try {
    const parsed = JSON.parse(saved) as UnderwritingCase[];
    return Array.isArray(parsed) ? parsed : resetCases();
  } catch {
    return resetCases();
  }
}

export function saveCases(cases: UnderwritingCase[]) {
  window.localStorage.setItem(CASES_KEY, JSON.stringify(cases));
}

export function resetCases() {
  window.localStorage.setItem(CASES_KEY, JSON.stringify(seedCases));
  return seedCases;
}

export function allEvents(cases: UnderwritingCase[]): AuditEvent[] {
  return cases
    .flatMap((c) => c.audit)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
