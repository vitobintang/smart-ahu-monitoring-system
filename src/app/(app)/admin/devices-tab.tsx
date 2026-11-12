"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import NumberFlow from "@number-flow/react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Grid3X3,
  HardDrive,
  Layers,
  Lock,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Table as TableIcon,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { api, fmtDateTime, LOCAL_POLL_MS, usePoll } from "@/lib/client";
import { Btn, Empty, ErrorNote, QualityTag, StatusBadge, cx } from "@/components/ui";
import { getDeviceImage, inferDeviceType } from "@/app/(app)/dashboard/cards";

interface DeviceRow {
  id: string;
  ahuId: string;
  label: string;
  sourceType: "PHYSICAL" | "SIMULATION";
  enabled: boolean;
  createdAt: string;
}

interface OverviewCardLite {
  ahu: { id: string; name: string; location: string; commTimeoutSec: number; deviceType?: string | null };
  status: string;
  lastSeenAt: string | null;
}

export default function DevicesTab() {
  // Lists the ACTIVE device source's modules only (Daikin DB ⇄ My DB switch).
  const devices = usePoll<{ devices: DeviceRow[]; physicalControlUnlocked: boolean }>("/api/devices", 10000);
  const overview = usePoll<{ cards: OverviewCardLite[] }>("/api/overview?lite=1", LOCAL_POLL_MS);

  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ENABLED" | "DISABLED">("ALL");

  const deviceRows = useMemo(() => devices.data?.devices ?? [], [devices.data?.devices]);

  // Map overview status/metadata to devices
  const enrichedDevices = useMemo(() => {
    const cardMap = new Map((overview.data?.cards ?? []).map((c) => [c.ahu.id, c]));
    return deviceRows.map((d) => {
      const card = cardMap.get(d.ahuId);
      const kind = inferDeviceType({ id: d.ahuId, name: d.label });
      return {
        ...d,
        kind,
        location: card?.ahu.location || "Facility Area",
        status: card?.status || (d.enabled ? "RUN" : "STOP"),
        lastSeenAt: card?.lastSeenAt || d.createdAt,
      };
    });
  }, [deviceRows, overview.data?.cards]);

  // Filtered devices
  const filteredDevices = useMemo(() => {
    return enrichedDevices.filter((d) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesId = d.ahuId.toLowerCase().includes(q);
        const matchesLabel = d.label.toLowerCase().includes(q);
        const matchesLoc = d.location.toLowerCase().includes(q);
        const matchesKind = d.kind.toLowerCase().includes(q);
        if (!matchesId && !matchesLabel && !matchesLoc && !matchesKind) return false;
      }
      if (statusFilter === "ENABLED" && !d.enabled) return false;
      if (statusFilter === "DISABLED" && d.enabled) return false;
      return true;
    });
  }, [enrichedDevices, searchQuery, statusFilter]);

  // Gateway stats
  const stats = useMemo(() => {
    const total = enrichedDevices.length;
    const active = enrichedDevices.filter((d) => d.enabled).length;
    const physical = enrichedDevices.filter((d) => d.sourceType === "PHYSICAL").length;
    return {
      total,
      active,
      paused: total - active,
      physicalPct: total > 0 ? Math.round((physical / total) * 100) : 100,
    };
  }, [enrichedDevices]);

  async function toggleDevice(d: DeviceRow) {
    setBusyId(d.id);
    setError(null);
    try {
      await api("/api/devices", { method: "POST", body: JSON.stringify({ deviceId: d.id, enabled: !d.enabled }) });
      await Promise.all([devices.reload(), overview.reload()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Module update failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <ErrorNote message={error || devices.error} />

      {/* ── KPI Summary Strip: Gateway Health, Protocol, Security & Safety (Linear / shadcn) ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
        {/* KPI 1: Active Ingestion Gateways */}
        <div className="panel card-hover group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white/95 via-white/90 to-blue-50/25 p-4 shadow-xs backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Ingestion Gateways</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-50 text-blue-600">
              <HardDrive size={15} />
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="num text-[26px] font-extrabold tracking-tight text-[#12294d]">
              <NumberFlow value={stats.active} />
            </span>
            <span className="text-[12px] font-semibold text-slate-400">/ {stats.total} Active</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              {stats.active === stats.total ? "100% ONLINE" : "PAUSED UNITS"}
            </span>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            Real-time telemetry ingestion pipelines
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
              style={{ width: `${stats.total > 0 ? (stats.active / stats.total) * 100 : 100}%` }}
            />
          </div>
        </div>

        {/* KPI 2: Protocol Driver */}
        <div className="panel card-hover group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white/95 via-white/90 to-emerald-50/25 p-4 shadow-xs backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Driver Architecture</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
              <Cpu size={15} />
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="num text-[26px] font-extrabold tracking-tight text-[#12294d]">
              S21 / RTDB
            </span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              OK PHYSICAL
            </span>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            Bi-directional RS-485 &amp; Firebase RTDB bridge
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: "100%" }} />
          </div>
        </div>

        {/* KPI 3: Security & Token Isolation */}
        <div className="panel card-hover group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white/95 via-white/90 to-purple-50/25 p-4 shadow-xs backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Bearer Token Security</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-purple-50 text-purple-600">
              <Lock size={15} />
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="num text-[26px] font-extrabold tracking-tight text-[#12294d]">
              Secured
            </span>
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">
              PRE-SHARED
            </span>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            Tokens isolated on owner deviceOwners tree
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-purple-500" style={{ width: "100%" }} />
          </div>
        </div>

        {/* KPI 4: Physical Safety Interlocks */}
        <div className="panel card-hover group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white/95 via-white/90 to-amber-50/25 p-4 shadow-xs backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Physical Interlock</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-50 text-amber-600">
              <ShieldCheck size={15} />
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="num text-[26px] font-extrabold tracking-tight text-[#12294d]">
              {devices.data?.physicalControlUnlocked ? "Commissioned" : "Active Interlock"}
            </span>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            Local hardware limits maintain precedence
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-amber-500" style={{ width: "100%" }} />
          </div>
        </div>
      </div>

      {/* ── Toolbar: Search, Filters & View Mode Switcher ── */}
      <div className="panel rounded-2xl border border-slate-200/80 bg-white/90 p-3 sm:p-4 shadow-xs backdrop-blur-md">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-[240px] flex-1 max-w-md">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search module id, device label, or room…"
              className="h-9 w-full rounded-xl border border-slate-200/90 bg-white pl-9 pr-3 text-[12px] font-medium text-[#12294d] placeholder-slate-400 shadow-2xs outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter Chips */}
            {[
              { id: "ALL", label: `All Modules (${enrichedDevices.length})` },
              { id: "ENABLED", label: `Streaming (${stats.active})` },
              { id: "DISABLED", label: `Paused (${stats.paused})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as typeof statusFilter)}
                className={cx(
                  "rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all",
                  statusFilter === tab.id
                    ? "bg-[#12294d] text-white shadow-2xs"
                    : "bg-[#f1f5fb] text-slate-600 hover:bg-[#e4ebf5]",
                )}
              >
                {tab.label}
              </button>
            ))}

            <span className="mx-1 h-4 w-px bg-slate-200" />

            {/* View Mode Toggle */}
            <div className="flex items-center rounded-xl border border-slate-200/80 bg-white/90 p-1 shadow-xs">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-bold transition-all",
                  viewMode === "grid"
                    ? "bg-[#2563eb] text-white shadow-xs"
                    : "text-slate-500 hover:text-[#12294d]",
                )}
                title="Gateway Cards View"
              >
                <Grid3X3 size={13} /> Cards
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-bold transition-all",
                  viewMode === "table"
                    ? "bg-[#2563eb] text-white shadow-xs"
                    : "text-slate-500 hover:text-[#12294d]",
                )}
                title="Table View"
              >
                <TableIcon size={13} /> Table
              </button>
            </div>

            <button
              type="button"
              onClick={() => void devices.reload()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/95 px-3 py-1.5 text-[11.5px] font-bold text-slate-700 shadow-xs transition hover:border-blue-300 hover:text-blue-600"
            >
              <RefreshCw size={12} className={devices.loading ? "animate-spin text-blue-600" : ""} /> Sync
            </button>
          </div>
        </div>
      </div>

      {/* ── View Mode 1: Rich Gateway Module Cards (Grid View - Default) ── */}
      {viewMode === "grid" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 sm:gap-5">
          {filteredDevices.map((d) => {
            const isBusy = busyId === d.id;
            return (
              <div
                key={d.id}
                className={cx(
                  "panel card-hover group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-sm backdrop-blur-md transition-all duration-300 hover:border-blue-400 hover:shadow-lg",
                  !d.enabled && "opacity-80 bg-slate-50/50",
                )}
              >
                <div>
                  {/* Card Header: Unit ID, Device Kind & Telemetry Quality */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/devices/${d.ahuId}`}
                          className="font-mono text-[14.5px] font-extrabold text-[#12294d] transition-colors group-hover:text-blue-600"
                        >
                          {d.ahuId}
                        </Link>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold text-slate-600">
                          {d.kind === "AHU" ? "AHU Plant" : d.kind === "AC_DAK" ? "Cassette" : d.kind === "AC_STANDING" ? "Standing" : "Wall Split"}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">{d.location}</p>
                    </div>

                    <span
                      className={cx(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider uppercase ring-1 ring-inset",
                        d.enabled
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-300"
                          : "bg-slate-100 text-slate-500 ring-slate-200",
                      )}
                    >
                      <span className={cx("h-1.5 w-1.5 rounded-full", d.enabled ? "bg-emerald-500 animate-pulse" : "bg-slate-400")} />
                      {d.enabled ? "STREAMING" : "PAUSED"}
                    </span>
                  </div>

                  {/* Device Visual Thumbnail & Protocol Ribbon */}
                  <div className="relative my-3 flex h-24 w-full items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-gradient-to-b from-[#f8fafc] to-[#eef4ff] p-2">
                    <Image
                      src={getDeviceImage({ id: d.ahuId, deviceType: d.kind })}
                      alt={d.ahuId}
                      fill
                      sizes="(max-width: 768px) 100vw, 320px"
                      className={cx("object-contain p-2 transition-transform duration-300 group-hover:scale-105", !d.enabled && "grayscale opacity-50")}
                    />
                    <div className="absolute right-2 top-2">
                      <QualityTag quality={d.sourceType === "SIMULATION" ? "SIMULATED" : "OK"} title={d.sourceType} />
                    </div>
                  </div>

                  {/* Ingestion Pipeline Specifications */}
                  <div className="space-y-2 rounded-xl border border-slate-100 bg-[#f8fafc] p-2.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-500 flex items-center gap-1">
                        <Cpu size={12} className="text-blue-500" /> Protocol
                      </span>
                      <span className="font-mono font-bold text-[#12294d] truncate max-w-[150px]">
                        {d.label}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-500 flex items-center gap-1">
                        <Lock size={12} className="text-purple-500" /> Token State
                      </span>
                      <span className="font-mono text-[10px] font-semibold text-slate-600 bg-slate-200/70 px-1.5 py-0.5 rounded">
                        Pre-Shared · Isolated
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-500 flex items-center gap-1">
                        <Activity size={12} className="text-emerald-500" /> Commissioned
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {fmtDateTime(d.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Action Footer: Ingestion Pause/Resume Switch & Twin Link */}
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => void toggleDevice(d)}
                    disabled={isBusy}
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold transition-all shadow-xs active:scale-95",
                      d.enabled
                        ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:border-rose-300"
                        : "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300",
                    )}
                  >
                    {isBusy ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <Power size={12} />
                    )}
                    {d.enabled ? "Pause Stream" : "Resume Stream"}
                  </button>

                  <Link
                    href={`/devices/${d.ahuId}`}
                    className="inline-flex items-center gap-1 rounded-xl bg-blue-50 px-2.5 py-1.5 text-[11px] font-bold text-blue-600 transition hover:bg-blue-100"
                  >
                    Twin &amp; Coils <ArrowRight size={12} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── View Mode 2: Enhanced Structured Table View ── */}
      {viewMode === "table" && (
        <div className="panel overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-md">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-slate-100 bg-[#f8fafc] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3.5">Device Asset</th>
                  <th className="px-5 py-3.5">Module Driver</th>
                  <th className="px-5 py-3.5">Source Pipeline</th>
                  <th className="px-5 py-3.5">Security &amp; Token</th>
                  <th className="px-5 py-3.5">Ingestion Status</th>
                  <th className="px-5 py-3.5">Commissioned</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDevices.map((d) => {
                  const isBusy = busyId === d.id;
                  return (
                    <tr key={d.id} className="transition-colors hover:bg-blue-50/30">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="relative h-10 w-12 flex-none overflow-hidden rounded-lg border border-slate-100 bg-[#f8fafc]">
                            <Image
                              src={getDeviceImage({ id: d.ahuId, deviceType: d.kind })}
                              alt={d.ahuId}
                              fill
                              sizes="48px"
                              className="object-contain p-1"
                            />
                          </div>
                          <div>
                            <Link href={`/devices/${d.ahuId}`} className="font-mono text-[13px] font-bold text-[#12294d] hover:text-blue-600">
                              {d.ahuId}
                            </Link>
                            <p className="truncate text-[10.5px] font-medium text-slate-500">{d.location}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 font-medium text-[#334155]">{d.label}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <QualityTag quality={d.sourceType === "SIMULATION" ? "SIMULATED" : "OK"} title={d.sourceType} />
                          <span className="font-mono text-[10.5px] font-semibold text-[#475569]">{d.sourceType}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                          <Lock size={10} className="text-purple-500" /> Hidden / Isolated
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={cx(
                            "rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ring-1 ring-inset",
                            d.enabled
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-300"
                              : "bg-slate-100 text-slate-600 ring-slate-300",
                          )}
                        >
                          {d.enabled ? "enabled" : "disabled"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[11px] text-[#475569]">{fmtDateTime(d.createdAt)}</td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <Btn size="sm" variant={d.enabled ? "default" : "primary"} onClick={() => void toggleDevice(d)} disabled={isBusy}>
                            {d.enabled ? "Disable" : "Enable"}
                          </Btn>
                          <Link
                            href={`/devices/${d.ahuId}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-blue-600 hover:bg-blue-50"
                          >
                            Twin <ArrowRight size={11} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredDevices.length === 0 && (
        <div className="panel rounded-2xl p-12 text-center bg-white/90">
          <Empty>No device monitoring modules match the search query.</Empty>
        </div>
      )}

      {/* ── Commissioning Safety & Interlock Notice (Bottom) ── */}
      <div className="rounded-2xl border border-amber-200/90 bg-gradient-to-br from-amber-50/90 via-amber-50/60 to-white/90 p-4 sm:p-5 shadow-xs backdrop-blur-md">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-amber-100 text-amber-800">
            <ShieldAlert size={16} />
          </span>
          <div className="text-[12px] leading-relaxed text-amber-950">
            <p className="font-bold uppercase tracking-wide text-amber-900">
              Hardware Interlock &amp; Commissioning Verification (FR-21 / Constraint 3)
            </p>
            <p className="mt-1 text-slate-600">
              Physical command dispatch is permitted only after field verification of motor thermal overloads, differential static
              pressure trip switches, and smoke dampers. Web-based telemetry pause controls isolate software ingestion buffers without
              disrupting hardwired emergency shutdown loops.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
