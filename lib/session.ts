"use client";

import { useEffect, useState } from "react";

// Deliberately lightweight demo access control -- no backend, no real auth. The "role" is just a
// value in localStorage that the sidebar switcher flips. Two roles:
//   user  -> application intake only: /submit
//   admin -> superset: dashboard, pool queue, audit log, case detail AND /submit
// Enforcement is client-side in <AppShell>: a disallowed route redirects to the role's landing page.

export type Role = "user" | "admin";

export const ROLE_KEY = "ai-ud-role";
export const ROLE_EVENT = "ai-ud-role-change";

export function getRole(): Role {
  if (typeof window === "undefined") return "user";
  try {
    return window.localStorage.getItem(ROLE_KEY) === "admin" ? "admin" : "user";
  } catch {
    return "user";
  }
}

export function setRole(role: Role) {
  try {
    window.localStorage.setItem(ROLE_KEY, role);
  } catch {
    // ignore -- private mode / storage disabled
  }
  window.dispatchEvent(new CustomEvent(ROLE_EVENT));
}

export const NAV_ITEMS: { href: string; label: string; roles: Role[]; group: string }[] = [
  { href: "/", label: "Dashboard", roles: ["admin"], group: "My Work" },
  { href: "/submit", label: "Submit Application", roles: ["user", "admin"], group: "Requests" },
  { href: "/pool-queue", label: "Pool Queue", roles: ["admin"], group: "Requests" },
  { href: "/audit", label: "Audit Log", roles: ["admin"], group: "Governance" }
];

export function canAccess(pathname: string, role: Role): boolean {
  if (pathname === "/submit") return true; // both roles
  if (pathname === "/" || pathname === "/pool-queue" || pathname === "/audit" || pathname.startsWith("/cases/")) {
    return role === "admin";
  }
  return true; // unknown routes stay open
}

export function landingFor(role: Role): string {
  return role === "admin" ? "/" : "/submit";
}

// Reactive role: updates on switcher changes (same tab) and storage events (other tabs).
export function useRole(): { role: Role; ready: boolean } {
  const [role, setRoleState] = useState<Role>("user");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setRoleState(getRole());
    setReady(true);
    const sync = () => setRoleState(getRole());
    window.addEventListener(ROLE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ROLE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return { role, ready };
}
