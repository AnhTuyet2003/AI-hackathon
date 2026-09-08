"use client";

import type { ReactNode } from "react";

/**
 * Presentational building blocks for the Dynamics 365 "model-driven app" look the mentor asked for:
 * a thin command bar, a record header strip, a horizontal tab bar, and titled form sections built
 * from label/value rows. All logic stays in the page clients -- these only lay things out.
 */

/* ---- command bar ------------------------------------------------------------ */

export function CommandBar({ children }: { children: ReactNode }) {
  return <div className="command-bar">{children}</div>;
}

export function CommandButton({
  children,
  onClick,
  disabled,
  type = "button",
  form,
  icon,
  primary
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  form?: string;
  icon?: ReactNode;
  primary?: boolean;
}) {
  return (
    <button className={primary ? "command-button-primary" : "command-button"} disabled={disabled} form={form} onClick={onClick} type={type}>
      {icon ? <span aria-hidden className="text-[15px] leading-none">{icon}</span> : null}
      {children}
    </button>
  );
}

export function CommandDivider() {
  return <span className="mx-1 h-5 w-px bg-line" />;
}

/* ---- record header -------------------------------------------------------- */

export type HeaderFact = { label: string; value: ReactNode };

export function RecordHeader({
  recordType,
  title,
  status,
  subtitle,
  facts
}: {
  recordType: string;
  title: string;
  status?: string;
  subtitle?: ReactNode;
  facts?: HeaderFact[];
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-line bg-white px-4 py-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{recordType}</p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
          <h1 className="truncate text-[19px] font-semibold text-ink">{title}</h1>
          {status ? <span className="text-[12px] text-muted">&mdash; {status}</span> : null}
        </div>
        {subtitle ? <p className="mt-1 text-[12px] text-muted">{subtitle}</p> : null}
      </div>
      {facts?.length ? (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {facts.map((f) => (
            <div key={f.label} className="min-w-[92px]">
              <p className="text-[13px] font-semibold text-ink">{f.value}</p>
              <p className="text-[11px] text-muted">{f.label}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---- tab bar ------------------------------------------------------------- */

export function TabBar<T extends string>({
  tabs,
  active,
  onChange
}: {
  tabs: readonly T[];
  active: T;
  onChange: (tab: T) => void;
}) {
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <button
          aria-selected={tab === active}
          className={`tab-item ${tab === active ? "tab-item-active" : ""}`}
          key={tab}
          onClick={() => onChange(tab)}
          role="tab"
          type="button"
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

/* ---- form sections + rows ---------------------------------------------- */

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  const map = { 1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3" } as const;
  return <div className={`grid gap-3 ${map[cols]}`}>{children}</div>;
}

export function FormSection({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`form-section ${className}`}>
      <h2 className="form-section-title">{title}</h2>
      {children}
    </section>
  );
}

export function FieldRow({ label, children, locked }: { label: string; children: ReactNode; locked?: boolean }) {
  return (
    <div className="field-row">
      <div className="field-row-label">
        {locked ? <span aria-hidden className="text-[11px] text-muted">&#128274;</span> : null}
        {label}
      </div>
      <div className="field-row-value">{children ?? <span className="text-muted">&mdash;</span>}</div>
    </div>
  );
}

/* ---- score bar (the "0.958 Accepted" widget) -------------------------- */

export function ScoreBar({
  score,
  max = 10,
  band,
  verdict
}: {
  score: number;
  max?: number;
  band: "low" | "medium" | "high";
  verdict?: string;
}) {
  const pct = Math.max(6, Math.min(100, Math.round((score / max) * 100)));
  const fill = { low: "bg-udgreen", medium: "bg-udamber", high: "bg-udred" }[band];
  const text = { low: "text-udgreen", medium: "text-udamber", high: "text-udred" }[band];

  return (
    <div>
      {verdict ? <p className={`mb-1 text-[12px] font-semibold ${text}`}>{verdict}</p> : null}
      <div className="relative h-6 w-full overflow-hidden rounded border border-line bg-slate-100">
        <div className={`h-full ${fill} opacity-80`} style={{ width: `${pct}%` }} />
        <span className="absolute inset-0 flex items-center px-2 text-[12px] font-semibold text-ink">
          {score} / {max} &nbsp;<span className="uppercase text-muted">{band}</span>
        </span>
      </div>
    </div>
  );
}

/* ---- small status dot (replaces some coloured pills) ------------------ */

export function StatusDot({ tone }: { tone: "green" | "blue" | "amber" | "red" | "grey" | "purple" }) {
  const map = {
    green: "bg-udgreen",
    blue: "bg-udblue",
    amber: "bg-udamber",
    red: "bg-udred",
    purple: "bg-udpurple",
    grey: "bg-slate-400"
  } as const;
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${map[tone]}`} />;
}
