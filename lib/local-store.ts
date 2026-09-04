"use client";

import { seedCases } from "./seed";
import type { AuditEvent, UnderwritingCase } from "./types";

const CASES_KEY = "ai-ud-cases";

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
  return cases.flatMap((c) => c.audit).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
