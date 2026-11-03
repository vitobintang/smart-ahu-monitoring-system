"use client";

import type { ReactNode } from "react";
import {
  COMMAND_STATUS_STYLE,
  PRIORITY_STYLE,
  QUALITY_LABEL,
  QUALITY_STYLE,
  SOURCE_STYLE,
  STATUS_STYLE,
  type DataQuality,
} from "@/lib/domain";
import type { AhuStatus, DataSource } from "@/db/schema";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Panel({
  title,
  subtitle,
  right,
  children,
  className,
  bodyClassName,
  icon,
  eyebrow,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  icon?: ReactNode;
}) {
  return (
    <section className={cx("panel overflow-hidden", className)}>
      {(title || right) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-700/80 bg-ink-850/40 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? (
              <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg border border-brand-500/25 bg-brand-500/10 text-brand-300">
                {icon}
              </span>
            ) : null}
            <div className="min-w-0">
              {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
              <h2 className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-slate-50">{title}</h2>
              {subtitle ? <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{subtitle}</p> : null}
            </div>
          </div>
          {right ? <div className="flex flex-none items-center gap-2">{right}</div> : null}
        </header>
      )}
      <div className={cx("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

const badgeBase =
  "inline-flex items-center gap-1.5 rounded-md font-mono font-semibold uppercase tracking-[0.04em] ring-1 ring-inset whitespace-nowrap";

export function StatusBadge({ status, size = "md" }: { status: AhuStatus; size?: "sm" | "md" }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={cx(
        badgeBase,
        s.badge,
        size === "sm" ? "px-1.5 py-[3px] text-[9.5px]" : "px-2 py-1 text-[10.5px]",
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {status === "RUN" || status === "FAULT" ? (
          <span className={cx("absolute inline-flex h-full w-full rounded-full opacity-70", s.dot)} />
        ) : null}
        <span className={cx("relative inline-flex h-1.5 w-1.5 rounded-full", s.dot.split(" ")[0])} />
      </span>
      {s.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cx(badgeBase, "px-1.5 py-[3px] text-[9.5px]", PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.LOW)}>
      {priority}
    </span>
  );
}

export function CommandStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cx(badgeBase, "px-1.5 py-[3px] text-[9.5px]", COMMAND_STATUS_STYLE[status] ?? COMMAND_STATUS_STYLE.REQUESTED)}
    >
      {status}
    </span>
  );
}

export function QualityTag({ quality, title }: { quality: DataQuality; title?: string }) {
  return (
    <span
      title={title ?? QUALITY_LABEL[quality]}
      className={cx(
        "inline-flex items-center rounded px-1.5 py-[2px] font-mono text-[8.5px] font-bold uppercase tracking-[0.05em] ring-1 ring-inset whitespace-nowrap",
        QUALITY_STYLE[quality],
      )}
    >
      {QUALITY_LABEL[quality]}
    </span>
  );
}

export function SourceTag({ source }: { source: DataSource | string | null }) {
  if (!source) return <span className="text-[11px] text-slate-600">—</span>;
  return (
    <span
      className={cx(
        "inline-flex items-center rounded px-1.5 py-[2px] font-mono text-[8.5px] font-bold uppercase tracking-[0.05em] ring-1 ring-inset whitespace-nowrap",
        SOURCE_STYLE[source as DataSource],
      )}
    >
      {source}
    </span>
  );
}

export function Metric({
  label,
  value,
  unit,
  quality,
  accent = "default",
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  quality?: DataQuality;
  accent?: "default" | "cyan" | "emerald" | "amber" | "muted" | "slate";
  sub?: ReactNode;
  className?: string;
}) {
  const accents = {
    default: "text-slate-100",
    cyan: "text-brand-300",
    emerald: "text-signal-400",
    amber: "text-amber-300",
    muted: "text-slate-400",
    slate: "text-slate-400",
  } as const;
  return (
    <div
      className={cx(
        "group relative overflow-hidden rounded-xl border border-ink-700/70 bg-ink-900/50 px-3 py-2.5 transition-colors hover:border-ink-600",
        className,
      )}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/25 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow truncate">{label}</p>
        {quality ? <QualityTag quality={quality} /> : null}
      </div>
      <p className={cx("num mt-1.5 text-[21px] font-semibold leading-none", accents[accent])}>
        {value}
        {unit ? <span className="ml-1 font-sans text-[11px] font-medium tracking-normal text-slate-500">{unit}</span> : null}
      </p>
      {sub ? <div className="mt-1.5 truncate text-[10px] leading-tight text-slate-600">{sub}</div> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "cyan" | "emerald" | "amber" | "red" | "violet";
  className?: string;
}) {
  const tones = {
    neutral: { text: "text-slate-100", ring: "border-ink-700", glow: "from-slate-500/8", icon: "text-slate-400" },
    cyan: { text: "text-brand-300", ring: "border-brand-500/30", glow: "from-brand-500/14", icon: "text-brand-400" },
    emerald: { text: "text-signal-400", ring: "border-signal-500/30", glow: "from-signal-500/14", icon: "text-signal-400" },
    amber: { text: "text-amber-300", ring: "border-amber-500/30", glow: "from-amber-500/14", icon: "text-amber-400" },
    red: { text: "text-red-300", ring: "border-red-500/35", glow: "from-red-500/14", icon: "text-red-400" },
    violet: { text: "text-violet-300", ring: "border-violet-500/30", glow: "from-violet-500/14", icon: "text-violet-400" },
  } as const;
  const t = tones[tone];
  return (
    <div className={cx("panel card-hover relative overflow-hidden p-4", t.ring, className)}>
      <span className={cx("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent", t.glow)} />
      <div className="relative">
        <div className="flex items-center gap-2">
          {icon ? <span className={t.icon}>{icon}</span> : null}
          <p className="eyebrow truncate">{label}</p>
        </div>
        <p className={cx("num mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em]", t.text)}>{value}</p>
        {sub ? <p className="mt-1.5 text-[11px] leading-tight text-slate-500">{sub}</p> : null}
      </div>
    </div>
  );
}

type BtnVariant = "default" | "primary" | "danger" | "success" | "ghost" | "subtle";

export function Btn({
  children,
  onClick,
  variant = "default",
  disabled,
  type = "button",
  className,
  title,
  size = "md",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
  size?: "sm" | "md";
}) {
  const variants: Record<BtnVariant, string> = {
    default: "border-[#e4eaf3] bg-white text-slate-600 hover:border-[#bfd7fe] hover:text-[#1d6ef2]",
    primary: "border-transparent bg-[#1d6ef2] text-white hover:bg-[#155bd4] shadow-[0_6px_16px_-8px_rgba(29,110,242,0.85)]",
    success: "border-transparent bg-[#16a34a] text-white hover:bg-[#15803d] shadow-[0_6px_16px_-8px_rgba(22,163,74,0.8)]",
    danger: "border-transparent bg-[#dc2626] text-white hover:bg-[#b91c1c] shadow-[0_6px_16px_-8px_rgba(220,38,38,0.8)]",
    subtle: "border-transparent bg-[#f2f6fb] text-slate-600 hover:bg-[#e6edf7] hover:text-[#1d6ef2]",
    ghost: "border-transparent bg-transparent text-slate-500 hover:bg-[#f2f6fb] hover:text-slate-800",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold tracking-[-0.01em] transition-all duration-150 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-35",
        size === "sm" ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-[11.5px]",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  labelOn,
  labelOff,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  labelOn?: string;
  labelOff?: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "inline-flex items-center gap-2.5 disabled:opacity-40",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <span className="switch-track" data-on={checked}>
        <span className="switch-knob" />
      </span>
      <span className="text-[11.5px] font-medium text-slate-300">
        {checked ? labelOn : labelOff}
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-lg border border-ink-600 bg-ink-900/70 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-[6px] font-semibold tracking-[-0.01em] transition-all duration-150",
            size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-[11.5px]",
            value === o.value
              ? "bg-brand-500/22 text-brand-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              : "text-slate-400 hover:text-slate-200",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[10.5px] leading-snug text-slate-600">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-ink-600 bg-ink-950/70 px-3 py-2 text-[13px] text-slate-100 outline-none transition placeholder:text-slate-600 hover:border-ink-500 focus:border-brand-500/70 focus:bg-ink-950 focus:ring-2 focus:ring-brand-500/18";

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-600/70 bg-ink-900/25 px-4 py-10 text-center">
      {icon ? <span className="text-slate-600">{icon}</span> : null}
      <p className="max-w-md text-[12.5px] leading-relaxed text-slate-500">{children}</p>
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-[12.5px] text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-400/25 border-t-brand-400" />
      {label}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="animate-rise rounded-lg border border-red-500/35 bg-red-500/8 px-3 py-2 text-[11.5px] leading-relaxed text-red-200">
      {message}
    </div>
  );
}

export function InfoNote({ children, tone = "cyan" }: { children: ReactNode; tone?: "cyan" | "amber" | "violet" }) {
  const tones = {
    cyan: "border-brand-500/30 bg-brand-500/8 text-brand-100/90",
    amber: "border-amber-500/30 bg-amber-500/8 text-amber-100/90",
    violet: "border-violet-500/30 bg-violet-500/8 text-violet-100/90",
  } as const;
  return (
    <div className={cx("rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed", tones[tone])}>{children}</div>
  );
}

export function PrintHeader({
  title,
  subtitle,
  meta,
}: {
  title: string;
  subtitle?: string;
  meta: Array<[string, string]>;
}) {
  const rows: Array<Array<[string, string] | null>> = [];
  for (let i = 0; i < meta.length; i += 2) rows.push([meta[i] ?? null, meta[i + 1] ?? null]);
  return (
    <div className="print-only" style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 24,
          borderBottom: "2pt solid #0f172a",
          paddingBottom: 10,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ahu/logo.png" alt="" style={{ width: 38, height: 38, borderRadius: 9 }} />
          <div>
            <p style={{ fontSize: "7.5pt", letterSpacing: "0.1em", textTransform: "uppercase", color: "#475569", margin: 0 }}>
              Smart Monitoring AHU · Air Handling Unit Monitoring &amp; Control System
            </p>
            <h1 style={{ fontSize: "16pt", fontWeight: 800, color: "#0f172a", margin: "2px 0 0" }}>{title}</h1>
            {subtitle ? (
              <p style={{ fontSize: "8.5pt", color: "#475569", margin: "2px 0 0" }}>{subtitle}</p>
            ) : null}
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: "7.5pt", color: "#475569", lineHeight: 1.5 }}>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "#0f172a" }}>Controlled document</strong>
          </p>
          <p style={{ margin: 0 }}>Uncontrolled when printed</p>
          <p style={{ margin: 0 }}>Confidential — operational use only</p>
        </div>
      </div>

      <table style={{ width: "100%", marginTop: 10, borderCollapse: "collapse", fontSize: "8pt" }}>
        <tbody>
          {rows.map((pair, r) => (
            <tr key={r}>
              {pair.flatMap((cell, c) =>
                cell
                  ? [
                      <td
                        key={`${r}-${c}-k`}
                        style={{ border: "0.6pt solid #cbd5e1", padding: "4px 7px", width: "22%", background: "#f1f5f9", color: "#0f172a", fontWeight: 700 }}
                      >
                        {cell[0]}
                      </td>,
                      <td
                        key={`${r}-${c}-v`}
                        style={{ border: "0.6pt solid #cbd5e1", padding: "4px 7px", width: "28%", color: "#334155" }}
                      >
                        {cell[1]}
                      </td>,
                    ]
                  : [
                      <td key={`${r}-${c}-k`} style={{ border: "0.6pt solid #cbd5e1", background: "#ffffff", width: "22%" }} />,
                      <td key={`${r}-${c}-v`} style={{ border: "0.6pt solid #cbd5e1", background: "#ffffff", width: "28%" }} />,
                    ],
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PrintFooter({ note }: { note: string }) {
  return (
    <div
      className="print-only"
      style={{ marginTop: 16, borderTop: "1pt solid #94a3b8", paddingTop: 6, fontSize: "7.5pt", color: "#475569" }}
    >
      {note}
    </div>
  );
}