"use client";

import Link from "next/link";
import { useState } from "react";
import { RoleSwitcher } from "@/components/RoleSwitcher";

type NavItem = { href: string; label: string; group: string };

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);

  const groups = items.reduce<Record<string, NavItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="lg:hidden">
      <div className="flex items-center justify-between border-b border-line bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded bg-udblue text-[11px] font-bold text-white">UD</div>
          <p className="text-[13px] font-semibold text-ink">AI-UD</p>
        </div>
        <button
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="grid h-8 w-8 place-items-center rounded border border-line"
          onClick={() => setOpen(true)}
          type="button"
        >
          <span className="grid gap-1">
            <span className="block h-0.5 w-5 bg-ink" />
            <span className="block h-0.5 w-5 bg-ink" />
            <span className="block h-0.5 w-5 bg-ink" />
          </span>
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex w-72 max-w-[80%] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded bg-udblue text-[11px] font-bold text-white">UD</div>
                <div>
                  <p className="text-[13px] font-semibold text-ink">AI-UD</p>
                  <p className="text-[11px] text-muted">Underwriting Dispatcher</p>
                </div>
              </div>
              <button
                aria-label="Close navigation"
                className="grid h-8 w-8 place-items-center rounded border border-line text-lg leading-none"
                onClick={() => setOpen(false)}
                type="button"
              >
                &times;
              </button>
            </div>

            <nav className="px-2 py-3">
              {Object.entries(groups).map(([group, groupItems]) => (
                <div className="mb-3" key={group}>
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">{group}</p>
                  <div className="grid gap-0.5">
                    {groupItems.map((item) => (
                      <Link
                        className="rounded px-2 py-2 text-[13px] text-ink transition hover:bg-slate-100"
                        href={item.href}
                        key={item.href}
                        onClick={() => setOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </nav>

            <RoleSwitcher onNavigate={() => setOpen(false)} />
          </div>

          <button aria-label="Close navigation" className="flex-1 bg-black/40" onClick={() => setOpen(false)} type="button" />
        </div>
      ) : null}
    </div>
  );
}
