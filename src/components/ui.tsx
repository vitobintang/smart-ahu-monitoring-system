"use client";

import type { ReactNode } from "react";
import NumberFlow from "@number-flow/react";
import {
  COMMAND_STATUS_STYLE,
  PRIORITY_STYLE,
  QUALITY_LABEL,
  QUALITY_STYLE,
  SOURCE_STYLE,
  STATUS_STYLE,
  type DataQuality,
} from "@/lib/domain";
import type { AhuStatus, DataSource } from "@/lib/types";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ─────────────────────────────────────────────────────────────
   PANEL / CARD (Aceternity / Beautiful UI / 21st.dev style)
   Glassmorphic surface, crisp borders, subtle elevation
   ───────────────────────────────────────────────────────────── */
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
    <section
      className={cx(
        "group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_4px_20px_-4px_rgba(15,23,42,0.06)] backdrop-blur-md transition-all duration-200 hover:shadow-[0_8px_30px_-6px_rgba(15,23,42,0.1)]",
        className,
      )}
    >
      {(title || right) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? (
              <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-xl border border-blue-500/20 bg-blue-500/10 text-blue-600 shadow-2xs">
                {icon}
              </span>
            ) : null}
            <div className="min-w-0">
              {eyebrow ? <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">{eyebrow}</p> : null}
              <h2 className="truncate text-[14px] font-bold tracking-[-0.01em] text-slate-900">{title}</h2>
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

/* ─────────────────────────────────────────────────────────────
   BADGES (shadcn / Radix / Base UI standard)
   High-contrast, micro-padding, live status dots
   ───────────────────────────────────────────────────────────── */
const badgeBase =
  "inline-flex items-center gap-1.5 rounded-md font-mono font-semibold uppercase tracking-[0.04em] ring-1 ring-inset whitespace-nowrap transition-colors";

export function StatusBadge({ status, size = "md" }: { status: AhuStatus; size?: "sm" | "md" }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={cx(
        badgeBase,
        s.badge,
        size === "sm" ? "px-2 py-0.5 text-[9.5px]" : "px-2.5 py-1 text-[10.5px]",
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {status === "RUN" || status === "FAULT" ? (
          <span className={cx("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", s.dot)} />
        ) : null}
        <span className={cx("relative inline-flex h-1.5 w-1.5 rounded-full", s.dot.split(" ")[0])} />
      </span>
      {s.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cx(badgeBase, "px-2 py-0.5 text-[9.5px]", PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.LOW)}>
      {priority}
    </span>
  );
}

export function CommandStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cx(badgeBase, "px-2 py-0.5 text-[9.5px]", COMMAND_STATUS_STYLE[status] ?? COMMAND_STATUS_STYLE.REQUESTED)}
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
        "inline-flex items-center rounded-md px-1.5 py-[2px] font-mono text-[8.5px] font-bold uppercase tracking-[0.05em] ring-1 ring-inset whitespace-nowrap",
        QUALITY_STYLE[quality],
      )}
    >
      {QUALITY_LABEL[quality]}
    </span>
  );
}

export function SourceTag({ source }: { source: DataSource | string | null }) {
  if (!source) return <span className="text-[11px] text-slate-400">—</span>;
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md px-1.5 py-[2px] font-mono text-[8.5px] font-bold uppercase tracking-[0.05em] ring-1 ring-inset whitespace-nowrap",
        SOURCE_STYLE[source as DataSource],
      )}
    >
      {source}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────
   METRIC TILE (NumberFlow + Magic UI micro-glow)
   Fluid animated counter transitions for sensor telemetry
   ───────────────────────────────────────────────────────────── */
export function Metric({
  label,
  value,
  unit,
  quality,
  accent = "default",
  sub,
  className,
  fractionDigits,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  quality?: DataQuality;
  accent?: "default" | "cyan" | "emerald" | "amber" | "muted" | "slate" | "red";
  sub?: ReactNode;
  className?: string;
  fractionDigits?: number;
}) {
  const accents = {
    default: "text-slate-900",
    cyan: "text-sky-700",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    muted: "text-slate-500",
    slate: "text-slate-700",
    red: "text-rose-700",
  } as const;

  const isNumeric = typeof value === "number" && !Number.isNaN(value);

  return (
    <div
      className={cx(
        "group relative overflow-hidden rounded-xl border border-slate-200/90 bg-white/90 p-3 shadow-2xs transition-all duration-200 hover:border-blue-300 hover:shadow-xs",
        className,
      )}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-blue-500/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        {quality ? <QualityTag quality={quality} /> : null}
      </div>
      <div className={cx("mt-1.5 flex items-baseline font-mono text-[22px] font-bold leading-none tracking-tight tabular-nums", accents[accent])}>
        {isNumeric ? (
          <NumberFlow
            value={value as number}
            format={
              fractionDigits !== undefined
                ? { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }
                : undefined
            }
            className="tabular-nums font-bold"
          />
        ) : (
          <span>{value}</span>
        )}
        {unit ? <span className="ml-1 font-sans text-[11px] font-semibold tracking-normal text-slate-500">{unit}</span> : null}
      </div>
      {sub ? <div className="mt-1.5 truncate text-[10.5px] leading-tight text-slate-500">{sub}</div> : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   STAT TILE (Bento Grid Magic UI + NumberFlow)
   Large dashboard overview tiles with gradient glows
   ───────────────────────────────────────────────────────────── */
export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
  className,
  fractionDigits,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "cyan" | "emerald" | "amber" | "red" | "violet";
  className?: string;
  fractionDigits?: number;
}) {
  const tones = {
    neutral: { text: "text-slate-900", ring: "border-slate-200/90 hover:border-slate-300", glow: "from-slate-500/5", icon: "text-slate-500" },
    cyan: { text: "text-sky-700", ring: "border-sky-200/90 hover:border-sky-300", glow: "from-sky-500/8", icon: "text-sky-600" },
    emerald: { text: "text-emerald-700", ring: "border-emerald-200/90 hover:border-emerald-300", glow: "from-emerald-500/8", icon: "text-emerald-600" },
    amber: { text: "text-amber-700", ring: "border-amber-200/90 hover:border-amber-300", glow: "from-amber-500/8", icon: "text-amber-600" },
    red: { text: "text-rose-700", ring: "border-rose-200/90 hover:border-rose-300", glow: "from-rose-500/8", icon: "text-rose-600" },
    violet: { text: "text-violet-700", ring: "border-violet-200/90 hover:border-violet-300", glow: "from-violet-500/8", icon: "text-violet-600" },
  } as const;

  const t = tones[tone];
  const isNumeric = typeof value === "number" && !Number.isNaN(value);

  return (
    <div
      className={cx(
        "group relative overflow-hidden rounded-2xl border bg-white/95 p-4 shadow-[0_4px_16px_-4px_rgba(15,23,42,0.05)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-4px_rgba(15,23,42,0.1)]",
        t.ring,
        className,
      )}
    >
      <span className={cx("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-80", t.glow)} />
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
          {icon ? <span className={t.icon}>{icon}</span> : null}
        </div>
        <div className={cx("mt-2 font-mono text-[28px] font-bold leading-none tracking-tight tabular-nums", t.text)}>
          {isNumeric ? (
            <NumberFlow
              value={value as number}
              format={
                fractionDigits !== undefined
                  ? { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }
                  : undefined
              }
              className="tabular-nums font-bold"
            />
          ) : (
            <span>{value}</span>
          )}
        </div>
        {sub ? <p className="mt-2 text-[11px] leading-tight text-slate-500">{sub}</p> : null}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   BUTTON (shadcn/ui + Base UI standards)
   Micro-interactions, active spring, subtle border shadows
   ───────────────────────────────────────────────────────────── */
type BtnVariant =
  | "default"
  | "primary"
  | "danger"
  | "destructive"
  | "success"
  | "ghost"
  | "subtle"
  | "outline"
  | "secondary";

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
  size?: "sm" | "md" | "lg" | "icon";
}) {
  const variants: Record<BtnVariant, string> = {
    default:
      "border-slate-200/90 bg-white text-slate-800 shadow-2xs hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900",
    primary:
      "border-transparent bg-blue-600 text-white shadow-xs hover:bg-blue-700 active:bg-blue-800 shadow-[0_4px_14px_-3px_rgba(37,99,235,0.4)]",
    secondary:
      "border-transparent bg-slate-100 text-slate-800 hover:bg-slate-200/80 active:bg-slate-200",
    outline:
      "border-slate-200 bg-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900",
    success:
      "border-transparent bg-emerald-600 text-white shadow-xs hover:bg-emerald-700 active:bg-emerald-800 shadow-[0_4px_14px_-3px_rgba(5,150,105,0.4)]",
    danger:
      "border-transparent bg-rose-600 text-white shadow-xs hover:bg-rose-700 active:bg-rose-800 shadow-[0_4px_14px_-3px_rgba(225,29,72,0.4)]",
    destructive:
      "border-transparent bg-rose-600 text-white shadow-xs hover:bg-rose-700 active:bg-rose-800 shadow-[0_4px_14px_-3px_rgba(225,29,72,0.4)]",
    subtle:
      "border-transparent bg-blue-50 text-blue-700 hover:bg-blue-100/80 active:bg-blue-100",
    ghost:
      "border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  };

  const sizes = {
    sm: "px-2.5 py-1.5 text-[11px] h-7",
    md: "px-3.5 py-2 text-[12px] h-9",
    lg: "px-5 py-2.5 text-[13px] h-10",
    icon: "h-9 w-9 p-0",
  };

  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex select-none items-center justify-center gap-1.5 rounded-xl border font-semibold tracking-[-0.01em] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        sizes[size],
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────
   SEGMENTED CONTROL (Apple iOS / shadcn Tabs)
   Pill slider background with tactile active state
   ───────────────────────────────────────────────────────────── */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      className={cx(
        "inline-flex items-center rounded-xl border border-slate-200/80 bg-slate-100/90 p-1 shadow-inner",
        className,
      )}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            className={cx(
              "rounded-lg font-semibold tracking-[-0.01em] transition-all duration-150",
              size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-[12px]",
              active
                ? "bg-white text-slate-900 shadow-2xs ring-1 ring-black/5"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   FIELD & INPUTS (shadcn Form standard)
   ───────────────────────────────────────────────────────────── */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[10.5px] leading-snug text-slate-500">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-slate-200/90 bg-white/95 px-3.5 py-2 text-[13px] text-slate-900 shadow-2xs placeholder:text-slate-400 outline-none transition-all duration-150 hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-3 focus:ring-blue-600/15 disabled:cursor-not-allowed disabled:opacity-50";

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-12 text-center">
      {icon ? <span className="text-slate-400">{icon}</span> : null}
      <p className="max-w-md text-[13px] leading-relaxed text-slate-500">{children}</p>
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-[12.5px] font-medium text-slate-600">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600/25 border-t-blue-600" />
      {label}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="animate-rise rounded-xl border border-rose-200 bg-rose-50/80 px-3.5 py-2.5 text-[12px] font-medium leading-relaxed text-rose-800 shadow-2xs">
      {message}
    </div>
  );
}
