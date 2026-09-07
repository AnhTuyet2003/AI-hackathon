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
    <div className="mt-8 border-t border-white/10 pt-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Signed in as</p>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-[#243449] p-1">
        {ROLES.map((r) => (
          <button
            className={`rounded-md px-2 py-1.5 text-xs font-bold capitalize transition ${
              role === r ? "bg-white text-udnavy" : "text-slate-300 hover:text-white"
            }`}
            key={r}
            onClick={() => change(r)}
            type="button"
          >
            {r}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-slate-400">
        {role === "user" ? "Intake only -- can submit applications." : "Full access -- dashboard, pool queue, audit & submit."}
      </p>
    </div>
  );
}
