export function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: "blue" | "green" | "red" | "amber" }) {
  const toneClass = {
    blue: "text-udblue",
    green: "text-udgreen",
    red: "text-udred",
    amber: "text-udamber"
  }[tone ?? "blue"];

  return (
    <div className="rounded-md border border-line bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">{label}</p>
      <strong className={`mt-1 block text-[22px] font-semibold ${toneClass}`}>{value}</strong>
    </div>
  );
}
