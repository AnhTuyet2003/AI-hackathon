"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { MobileNav } from "@/components/MobileNav";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { NAV_ITEMS, canAccess, landingFor, useRole } from "@/lib/session";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role, ready } = useRole();
  const pathname = usePathname();
  const router = useRouter();

  const allowed = canAccess(pathname, role);

  useEffect(() => {
    if (ready && !allowed) router.replace(landingFor(role));
  }, [ready, allowed, role, router]);

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <div className="min-h-screen bg-[#f6f7f9] lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <MobileNav items={visibleNav} />
      <aside className="hidden bg-udnavy p-6 text-white lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-blue-50 font-black text-[#153b64]">UD</div>
          <div>
            <p className="font-black">AI-UD</p>
            <p className="text-xs text-slate-300">Underwriting Dispatcher</p>
          </div>
        </div>

        <nav className="mt-8 grid gap-2">
          {visibleNav.map((item) => (
            <Link
              className="rounded-lg px-3 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-[#243449] hover:text-white"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <RoleSwitcher />
      </aside>

      <main className="min-w-0 p-5 md:p-8">{!ready ? null : allowed ? children : <Redirecting role={role} />}</main>
    </div>
  );
}

function Redirecting({ role }: { role: string }) {
  return (
    <div className="shell-card p-8">
      <h1 className="text-2xl font-black">Access restricted</h1>
      <p className="mt-2 text-muted">
        This page is not available for the <strong>{role}</strong> role. Redirecting...
      </p>
    </div>
  );
}
