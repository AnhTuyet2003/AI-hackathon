export function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: "blue" | "green" | "red" | "amber" }) {
  const toneClass = {
    blue: "text-udblue",
    green: "text-udgreen",
    red: "text-udred",
    amber: "text-udamber"
  }[tone ?? "blue"];

  return (
    <div className="shell-card p-4">
      <p className="text-xs font-bold text-muted">{label}</p>
      <strong className={`mt-1 block text-2xl font-black ${toneClass}`}>{value}</strong>
    </div>
  );
}
