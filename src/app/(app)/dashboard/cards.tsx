"use client";

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Droplets,
  Fan,
  Gauge,
  MapPin,
  Thermometer,
  TriangleAlert,
} from "lucide-react";
import type { AhuStatus } from "@/lib/types";
import { timeAgo } from "@/lib/client";
import { cx } from "@/components/ui";

export interface Card {
  ahu: { id: string; name: string; location: string; commTimeoutSec: number; hasHeater: boolean; installedSensors: string[]; controlMode: string; setpoint: number; desiredRunState: string; deviceType?: string | null };
  status: AhuStatus;
  ageSec: number | null;
  stale: boolean;
  lastSeenAt: string | null;
  source: string | null;
  values: Record<string, number | null>;
  fallback: { current: boolean; voltage: boolean };
  activeAlarms: number;
  criticalAlarms: number;
  unackedAlarms: number;
  trendAlerts: number;
  activeCommand: { id: string; commandType: string; status: string; expiresAt: string } | null;
}

/** Product-shot preview per device kind — same white studio style as the AHU shot. */
const DEVICE_IMG: Record<string, string> = {
  AC_SPLIT_WALL: "/ahu/unit-split-t.png",
  AC_DAK: "/ahu/unit-dak-t.png",
  AC_STANDING: "/ahu/unit-standing-t.png",
};

const PILL: Record<AhuStatus, { label: string; cls: string }> = {
  RUN: { label: "RUNNING", cls: "bg-[#22c55e] text-white shadow-[0_6px_14px_-6px_rgba(34,197,94,0.9)]" },
  STOP: { label: "STOPPED", cls: "bg-[#f5b301] text-white shadow-[0_6px_14px_-6px_rgba(245,179,1,0.9)]" },
  FAULT: { label: "FAULT", cls: "bg-[#ef4444] text-white shadow-[0_6px_14px_-6px_rgba(239,68,68,0.9)]" },
  OFFLINE: { label: "OFFLINE", cls: "bg-[#8b98ab] text-white" },
};
export function Tile({
  tile,
  grad,
  glow,
  value,
  valueClass,
  label,
  mobileTag,
  mobileBanner,
  viz,
  caption,
  alert,
  href,
}: {
  tile: ReactNode;
  grad: string;
  glow: string;
  value: string;
  valueClass?: string;
  label: string;
  mobileTag?: string;
  mobileBanner?: boolean;
  viz: ReactNode;
  caption: ReactNode;
  alert?: boolean;
  href?: string;
}) {
  const body = mobileBanner ? (
    <div
      className={cx(
        "panel card-hover relative flex h-full flex-col rounded-2xl p-3.5 sm:p-5",
        alert && "border-red-200 bg-red-50/40",
      )}
    >
      <div className="flex items-center gap-3 sm:items-start sm:gap-3.5">
        <span
          className={cx(
            "grid h-10 w-10 flex-none place-items-center rounded-xl bg-linear-to-br text-white sm:h-14 sm:w-14 sm:rounded-2xl",
            grad,
          )}
          style={{ boxShadow: `0 10px 22px -10px ${glow}` }}
        >
          {tile}
        </span>
        <span className="min-w-0 flex-1 pr-5 sm:pr-0">
          <span className={valueClass ?? "num block text-[22px] font-bold leading-tight tracking-[-0.02em] text-[#12294d] sm:text-[26px]"}>
            {value}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-snug text-slate-500 sm:text-[11.5px]">{label}</span>
        </span>
      </div>
      <div className="mt-2 hidden h-8 flex-1 items-center sm:mt-3 sm:flex">{viz}</div>
      <div className="mt-2 border-t border-[#eef2f7] pt-1.5 text-[10px] font-semibold sm:mt-2.5 sm:pt-2 sm:text-[10.5px]">
        {caption}
      </div>
      {href ? (
        <ChevronRight size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[#2563eb] sm:right-4" />
      ) : null}
    </div>
  ) : (
    <div
      className={cx(
        "panel card-hover relative flex min-h-[116px] h-full flex-col gap-2 rounded-2xl p-3 sm:min-h-0 sm:justify-start sm:gap-0 sm:p-5",
        alert && "border-red-200 bg-red-50/40",
      )}
    >
      {/* Compact Square Mobile Layout (< sm) */}
      <div className="flex items-start justify-between gap-2 sm:hidden">
        <span
          className={cx("grid h-10 w-10 flex-none place-items-center rounded-xl bg-linear-to-br text-white", grad)}
          style={{ boxShadow: `0 10px 20px -10px ${glow}` }}
        >
          {tile}
        </span>
        {mobileTag ? (
          <span
            className={cx(
              "rounded-md px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider",
              alert ? "bg-red-100 text-red-700" : "bg-[#eff4fb] text-[#334155]",
            )}
          >
            {mobileTag}
          </span>
        ) : null}
      </div>
      <div className="sm:hidden">
        <span className="num block truncate text-[25px] font-extrabold leading-none tracking-[-0.03em] text-[#12294d]">
          {value}
        </span>
        <span className="mt-1 block truncate text-[12px] font-semibold text-slate-600">{label}</span>
      </div>
      <div className="mt-auto border-t border-[#eef2f7] pt-1.5 text-[10.5px] font-semibold sm:hidden">{caption}</div>

      {/* Rich Tablet/Desktop Layout (>= sm) */}
      <div className="hidden items-start gap-3.5 sm:flex">
        <span
          className={cx("grid h-14 w-14 flex-none place-items-center rounded-2xl bg-linear-to-br text-white", grad)}
          style={{ boxShadow: `0 12px 26px -10px ${glow}` }}
        >
          {tile}
        </span>
        <span className="min-w-0">
          <span className={valueClass ?? "num block text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#12294d]"}>
            {value}
          </span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500">{label}</span>
        </span>
      </div>
      <div className="mt-3 hidden h-8 flex-1 items-center sm:flex">{viz}</div>
      <div className="mt-2.5 hidden border-t border-[#eef2f7] pt-2 text-[10.5px] font-semibold sm:block">{caption}</div>
    </div>
  );
  const wrapCls = cx(mobileBanner && "col-span-2 sm:col-span-2 lg:col-span-1");
  return href ? (
    <Link href={href} className={cx("group block h-full", wrapCls)} title="Sync & system event log (FR-29)">
      {body}
    </Link>
  ) : wrapCls ? (
    <div className={wrapCls}>{body}</div>
  ) : (
    body
  );
}

export function Bars({ bars, color }: { bars: number[]; color: string }) {
  return (
    <span className="flex h-8 w-full items-end justify-end gap-[3px]">
      {(bars.length ? bars : Array.from({ length: 12 }, () => 0.3)).map((h, i) => (
        <span
          key={i}
          className="w-1.5 rounded-sm"
          style={{ height: `${Math.max(14, h * 100)}%`, background: color, opacity: 0.4 + (i / 12) * 0.6 }}
        />
      ))}
    </span>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <span className="flex w-full items-center">
      <span className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80">
        <span
          className="block h-full rounded-full bg-linear-to-r from-[#22c55e] to-[#4ade80]"
          style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
        />
      </span>
    </span>
  );
}

export function UnitCard({ card }: { card: Card }) {
  const pill = PILL[card.status];
  const v = card.values;
  const off = card.status === "OFFLINE";
  const fanPct = v.fanSpeed ?? 0;
  const C = 2 * Math.PI * 26;
  const gid = `gauge-${card.ahu.id}`;

  const shortStatus =
    card.status === "RUN" ? "RUN" : card.status === "STOP" ? "STOP" : card.status === "FAULT" ? "FAULT" : "OFF";

  return (
    <>
      {/* Compact Square Mobile AHU Card (< sm) */}
      <Link
        href={`/devices/${card.ahu.id}?from=/dashboard`}
        className={cx(
          "panel card-hover flex flex-col justify-between rounded-2xl p-3 sm:hidden",
          card.status === "FAULT" && "border-red-200 bg-red-50/30",
        )}
      >
        <div>
          <div className="flex items-center justify-between gap-1.5">
            <span className="font-mono text-[13.5px] font-extrabold tracking-[-0.01em] text-[#12294d]">
              {card.ahu.id}
            </span>
            <span
              className={cx(
                "rounded-md px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-wider",
                pill.cls,
              )}
            >
              {shortStatus}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[10px] font-medium text-slate-500">{card.ahu.location}</p>
        </div>

        {/* Product preview picture (matches desktop preview) */}
        <div className="relative my-2 h-16 w-full overflow-hidden">
          <Image
            src={DEVICE_IMG[card.ahu.deviceType ?? ""] ?? "/ahu/unit-iso2-t.png"}
            alt={`${card.ahu.id} unit`}
            fill
            sizes="(max-width: 640px) 45vw, 128px"
            className={cx("scale-[1.15] object-contain", off && "opacity-40 grayscale")}
          />
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-lg bg-[#f4f7fc] px-2 py-1.5">
            <span className="block text-[8.5px] font-bold uppercase tracking-wider text-slate-400">Temp</span>
            <span className="num block text-[12.5px] font-bold leading-tight text-[#12294d]">
              {off || v.supplyTemp === null ? "—" : `${v.supplyTemp.toFixed(1)}°C`}
            </span>
          </div>
          <div className="rounded-lg bg-[#f4f7fc] px-2 py-1.5">
            <span className="block text-[8.5px] font-bold uppercase tracking-wider text-slate-400">RH</span>
            <span className="num block text-[12.5px] font-bold leading-tight text-[#12294d]">
              {off || v.humidity === null ? "—" : `${v.humidity.toFixed(0)}%`}
            </span>
          </div>
          <div className="rounded-lg bg-[#f4f7fc] px-2 py-1.5">
            <span className="block text-[8.5px] font-bold uppercase tracking-wider text-slate-400">Fan</span>
            <span className="num block text-[12.5px] font-bold leading-tight text-[#12294d]">
              {off || v.fanSpeed === null ? "—" : `${v.fanSpeed.toFixed(0)}%`}
            </span>
          </div>
          <div
            className={cx(
              "rounded-lg px-2 py-1.5",
              card.activeAlarms > 0 ? "bg-red-50" : "bg-[#f4f7fc]",
            )}
          >
            <span className="block text-[8.5px] font-bold uppercase tracking-wider text-slate-400">Alarms</span>
            <span
              className={cx(
                "num block text-[12.5px] font-bold leading-tight",
                card.activeAlarms > 0 ? "text-red-600" : "text-emerald-600",
              )}
            >
              {off ? "—" : card.activeAlarms > 0 ? `${card.activeAlarms} ALM` : "0 OK"}
            </span>
          </div>
        </div>
      </Link>

      {/* Full Tablet/Desktop AHU Card (>= sm) */}
      <div className="panel card-hover hidden rounded-2xl p-5 sm:block">
        <div className="flex items-start justify-between gap-2">
          <p className="font-mono text-[15px] font-bold tracking-[-0.01em] text-[#12294d]">{card.ahu.id}</p>
          <span className={cx("rounded-md px-2.5 py-1 font-mono text-[9.5px] font-bold uppercase tracking-wider", pill.cls)}>
            {pill.label}
          </span>
        </div>
        <p className="mt-1 flex items-center gap-1 truncate text-[10.5px] text-slate-400">
          <MapPin size={10} className="flex-none" /> {card.ahu.location}
        </p>

        <div className="mt-3 flex items-center gap-3">
          <div className="relative h-[84px] w-32 flex-none overflow-hidden">
            <Image
              src={DEVICE_IMG[card.ahu.deviceType ?? ""] ?? "/ahu/unit-iso2-t.png"}
              alt={`${card.ahu.id} unit`}
              fill
              sizes="128px"
              className={cx("scale-[1.22] object-contain", off && "opacity-40 grayscale")}
            />
          </div>
          <div className="grid flex-1 gap-1.5">
            <Row icon={<Thermometer size={13} />} value={off || v.supplyTemp === null ? "--" : v.supplyTemp.toFixed(1)} unit="°C" />
            <Row icon={<Droplets size={13} />} value={off || v.humidity === null ? "--" : v.humidity.toFixed(0)} unit="%RH" />
            <Row
              icon={<Gauge size={13} />}
              value={off || v.filterDiffPressure === null ? "--" : v.filterDiffPressure.toFixed(0)}
              unit="Pa"
              alarm={card.status === "FAULT"}
            />
            <Row icon={<Fan size={13} />} value={off || v.fanSpeed === null ? "--" : v.fanSpeed.toFixed(0)} unit="%" />
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <div className="relative h-[62px] w-[62px]">
              <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
                <defs>
                  <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#2563eb" />
                    <stop offset="100%" stopColor="#22c55e" />
                  </linearGradient>
                </defs>
                <circle cx={32} cy={32} r={26} fill="none" stroke="#e8edf4" strokeWidth={7} />
                <circle
                  cx={32}
                  cy={32}
                  r={26}
                  fill="none"
                  stroke={card.status === "RUN" ? `url(#${gid})` : card.status === "FAULT" ? "#ef4444" : "#cbd5e1"}
                  strokeWidth={7}
                  strokeLinecap="round"
                  strokeDasharray={`${(Math.min(100, fanPct) / 100) * C} ${C}`}
                />
              </svg>
              <span className="num absolute inset-0 grid place-items-center text-[12.5px] font-bold text-[#12294d]">
                {off ? "—" : `${fanPct.toFixed(0)}%`}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-slate-400">Fan Speed</p>
          </div>

          {off ? (
            <span className="flex items-center gap-1.5 pb-4 text-[10.5px] text-slate-400">
              <Clock size={12} /> Last seen {card.lastSeenAt ? timeAgo(card.lastSeenAt) : "—"}
            </span>
          ) : (
            <span
              className={cx(
                "flex items-center gap-1.5 pb-4 text-[11.5px] font-semibold",
                card.activeAlarms > 0 ? "text-red-500" : "text-slate-600",
              )}
            >
              {card.activeAlarms > 0 ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} className="text-emerald-500" />}
              Alarms
              <span
                className={cx(
                  "num rounded-md px-2 py-0.5 text-[10.5px] font-bold",
                  card.activeAlarms > 0 ? "bg-red-50 text-red-500" : "bg-[#f1f5fb] text-slate-500",
                )}
              >
                {card.activeAlarms}
              </span>
            </span>
          )}
        </div>

        <div className="mt-1 flex justify-end border-t border-[#f1f5f9] pt-2.5">
          <Link href={`/devices/${card.ahu.id}?from=/dashboard`} className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[#2563eb] hover:underline">
            View Details <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </>
  );
}

export function Row({ icon, value, unit, alarm }: { icon: ReactNode; value: string; unit: string; alarm?: boolean }) {
  return (
    <span className="flex items-center gap-2 text-[12px]">
      <span className="text-slate-400">{icon}</span>
      <span className={cx("num font-bold", alarm ? "text-red-500" : "text-[#12294d]")}>{value}</span>
      <span className="text-[10.5px] font-semibold text-slate-400">{unit}</span>
    </span>
  );
}

export function HealthRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[#eef4ff] text-[#2563eb]">{icon}</span>
      <span className="flex-1 text-[12px] text-slate-600">{label}</span>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {value}
      </span>
    </div>
  );
}
