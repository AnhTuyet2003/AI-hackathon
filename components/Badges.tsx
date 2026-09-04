import type { CaseStatus, ComplexityBand } from "@/lib/types";

export function StatusBadge({ status }: { status: CaseStatus }) {
  const styles: Record<CaseStatus, string> = {
    PENDING: "bg-slate-100 text-muted",
    ASSIGNED_STP: "bg-green-50 text-udgreen",
    ASSIGNED_MANUAL: "bg-blue-50 text-udblue",
    POOL_QUEUE: "bg-red-50 text-udred",
    RESOLVED: "bg-purple-50 text-udpurple"
  };
  const labels: Record<CaseStatus, string> = {
    PENDING: "Pending",
    ASSIGNED_STP: "Auto-Assigned (STP)",
    ASSIGNED_MANUAL: "Manual Review",
    POOL_QUEUE: "Pool Queue",
    RESOLVED: "Resolved"
  };

  return <span className={`rounded-full px-2.5 py-1 text-xs font-black ${styles[status]}`}>{labels[status]}</span>;
}

export function ComplexityBadge({ band, score }: { band: ComplexityBand; score: number }) {
  const styles: Record<ComplexityBand, string> = {
    low: "bg-green-50 text-udgreen",
    medium: "bg-amber-50 text-udamber",
    high: "bg-red-50 text-udred"
  };

  return <span className={`rounded-full px-2.5 py-1 text-xs font-black ${styles[band]}`}>{band.toUpperCase()} -- SCORE {score}</span>;
}
