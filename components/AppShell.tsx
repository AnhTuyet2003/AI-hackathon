import Link from "next/link";
import { MobileNav } from "@/components/MobileNav";

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/submit", label: "Submit Application" },
  { href: "/pool-queue", label: "Pool Queue" },
  { href: "/audit", label: "Audit Log" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f7f9] lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <MobileNav />
      <aside className="hidden bg-udnavy p-6 text-white lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-blue-50 font-black text-[#153b64]">UD</div>
          <div>
            <p className="font-black">AI-UD</p>
            <p className="text-xs text-slate-300">Underwriting Dispatcher</p>
          </div>
        </div>

        <nav className="mt-8 grid gap-2">
          {nav.map((item) => (
            <Link
              className="rounded-lg px-3 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-[#243449] hover:text-white"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 p-5 md:p-8">{children}</main>
    </div>
  );
}
