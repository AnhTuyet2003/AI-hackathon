"use client";

import { useRouter } from "next/navigation";
import { landingFor, setRole, useRole, type Role } from "@/lib/session";

const ROLES: Role[] = ["user", "admin"];

export function RoleSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { role } = useRole();
  const router = useRouter();

  function change(next: Role) {
    if (next !== role) setRole(next);
    onNavigate?.();
    router.replace(landingFor(next));
  }

  return (
    <div className="mx-2 mt-2 border-t border-line pt-3">
      <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Signed in as</p>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-md border border-line bg-white p-1">
        {ROLES.map((r) => (
          <button
            className={`rounded px-2 py-1.5 text-[12px] font-semibold capitalize transition ${
              role === r ? "bg-udblue text-white" : "text-muted hover:bg-slate-100 hover:text-ink"
            }`}
            key={r}
            onClick={() => change(r)}
            type="button"
          >
            {r}
          </button>
        ))}
      </div>
      <p className="mt-2 px-2 pb-3 text-[11px] leading-4 text-muted">
        {role === "user" ? "Intake only — can submit applications." : "Full access — dashboard, pool queue, audit & submit."}
      </p>
    </div>
  );
}
