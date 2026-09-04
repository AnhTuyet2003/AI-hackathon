import Link from "next/link";

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/submit", label: "Submit Application" },
  { href: "/pool-queue", label: "Pool Queue" },
  { href: "/audit", label: "Audit Log" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f7f9] lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="bg-udnavy p-6 text-white lg:min-h-screen">
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

        <div className="mt-10 rounded-lg border border-white/15 bg-white/5 p-4">
          <p className="text-sm font-extrabold">Pipeline</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
            <li>Data Ingestion Engine</li>
            <li>Complexity Classifier + NER</li>
            <li>Filter Node (8 policies)</li>
            <li>Optimization Node (matching)</li>
            <li>STP / Manual / Pool Queue</li>
          </ul>
        </div>
      </aside>

      <main className="min-w-0 p-5 md:p-8">{children}</main>
    </div>
  );
}
