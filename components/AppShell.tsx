"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { MobileNav } from "@/components/MobileNav";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { NAV_ITEMS, canAccess, landingFor, useRole } from "@/lib/session";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/cases/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role, ready } = useRole();
  const pathname = usePathname();
  const router = useRouter();

  const allowed = canAccess(pathname, role);

  useEffect(() => {
    if (ready && !allowed) router.replace(landingFor(role));
  }, [ready, allowed, role, router]);

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(role));
  const groups = visibleNav.reduce<Record<string, typeof visibleNav>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-[#f3f2f1] lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <MobileNav items={visibleNav} />
      <aside className="hidden border-r border-line bg-[#fafafa] lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="grid h-8 w-8 place-items-center rounded bg-udblue text-[11px] font-bold text-white">UD</div>
          <div>
            <p className="text-[13px] font-semibold text-ink">AI-UD</p>
            <p className="text-[11px] text-muted">Underwriting Dispatcher</p>
          </div>
        </div>

        <nav className="px-2 py-3">
          {Object.entries(groups).map(([group, items]) => (
            <div className="mb-3" key={group}>
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">{group}</p>
              <div className="grid gap-0.5">
                {items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      className={`flex items-center gap-2 rounded px-2 py-2 text-[13px] transition ${
                        active
                          ? "border-l-2 border-udblue bg-blue-50 font-semibold text-udblue"
                          : "border-l-2 border-transparent text-ink hover:bg-slate-100"
                      }`}
                      href={item.href}
                      key={item.href}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <RoleSwitcher />
      </aside>

      <main className="min-w-0">{!ready ? null : allowed ? children : <Redirecting role={role} />}</main>
    </div>
  );
}

function Redirecting({ role }: { role: string }) {
  return (
    <div className="m-4 shell-card p-6">
      <h1 className="text-[19px] font-semibold">Access restricted</h1>
      <p className="mt-2 text-muted">
        This page is not available for the <strong>{role}</strong> role. Redirecting&hellip;
      </p>
    </div>
  );
}
