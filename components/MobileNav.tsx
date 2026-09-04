"use client";

import Link from "next/link";
import { useState } from "react";

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/submit", label: "Submit Application" },
  { href: "/pool-queue", label: "Pool Queue" },
  { href: "/audit", label: "Audit Log" }
];

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <div className="flex items-center justify-between bg-udnavy px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-sm font-black text-[#153b64]">UD</div>
          <p className="font-black">AI-UD</p>
        </div>
        <button
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="grid h-9 w-9 place-items-center rounded-lg border border-white/20"
          onClick={() => setOpen(true)}
          type="button"
        >
          <span className="grid gap-1">
            <span className="block h-0.5 w-5 bg-white" />
            <span className="block h-0.5 w-5 bg-white" />
            <span className="block h-0.5 w-5 bg-white" />
          </span>
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex w-72 max-w-[80%] flex-col bg-udnavy p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-lg bg-blue-50 font-black text-[#153b64]">UD</div>
                <div>
                  <p className="font-black">AI-UD</p>
                  <p className="text-xs text-slate-300">Underwriting Dispatcher</p>
                </div>
              </div>
              <button
                aria-label="Close navigation"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/20 text-lg leading-none"
                onClick={() => setOpen(false)}
                type="button"
              >
                &times;
              </button>
            </div>

            <nav className="mt-8 grid gap-2">
              {nav.map((item) => (
                <Link
                  className="rounded-lg px-3 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-[#243449] hover:text-white"
                  href={item.href}
                  key={item.href}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <button aria-label="Close navigation" className="flex-1 bg-black/50" onClick={() => setOpen(false)} type="button" />
        </div>
      ) : null}
    </div>
  );
}
