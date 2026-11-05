"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, MapPin } from "lucide-react";
import type { AhuStatus } from "@/db/schema";
import { LOCAL_POLL_MS, timeAgo, usePoll } from "@/lib/client";
import { useSessionUser } from "@/components/AppShell";
import ControlPanel from "@/components/ControlPanel";
import { can } from "@/lib/domain";
import { Empty, ErrorNote, Spinner, StatusBadge, cx } from "@/components/ui";

interface Card {
  ahu: {
    id: string;
    name: string;
    location: string;
    hasHeater: boolean;
    installedSensors: string[];
    setpoint: number;
    controlMode: "AUTO" | "MANUAL";
    desiredRunState: "RUN" | "STOP";
  };
  status: AhuStatus;
  lastSeenAt: string | null;
  source: string | null;
  values: Record<string, number | null>;
  activeAlarms: number;
  unackedAlarms: number;
  activeCommand: { id: string; commandType: string; status: string; expiresAt: string } | null;
}

/** FR-03 / FR-05: fleet index of all AHU units. */
export default function AhuIndexPage() {
  const user = useSessionUser();
  const canControl = user ? can(user.role, "control") : false;
  const { data, error, loading, reload } = usePoll<{ cards: Card[] }>("/api/overview?lite=1", LOCAL_POLL_MS);

  if (loading && !data) return <Spinner label="Loading AHU fleet…" />;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="text-[20px] font-bold tracking-[-0.02em] text-[#12294d] sm:text-[22px]">AHU Units</h1>
        <p className="text-[12px] text-slate-500">
          All provisioned air handling units · live status, sensors, and control (FR-05)
        </p>
      </div>

      <ErrorNote message={error} />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
        {(data?.cards ?? []).map((c) => (
          <div key={c.ahu.id}>
            {/* Compact Square Mobile Card (< sm) */}
            <div
              className={cx(
                "panel card-hover flex aspect-square flex-col justify-between rounded-2xl p-3 sm:hidden",
                c.status === "FAULT" && "border-red-200 bg-red-50/30",
              )}
            >
              <Link href={`/ahu/${c.ahu.id}`} className="block min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono text-[13.5px] font-extrabold text-[#12294d]">{c.ahu.id}</span>
                  <StatusBadge status={c.status} size="sm" />
                </div>
                <p className="mt-0.5 truncate text-[10px] font-medium text-slate-500">{c.ahu.location}</p>
              </Link>

              <Link href={`/ahu/${c.ahu.id}`} className="grid grid-cols-2 gap-1.5">
                <div className="rounded-lg bg-[#f4f7fc] px-2 py-1">
                  <span className="block text-[8px] font-bold uppercase tracking-wider text-slate-400">Temp</span>
                  <span className="num block text-[12px] font-bold text-[#12294d]">
                    {c.values.supplyTemp === null || c.values.supplyTemp === undefined
                      ? "—"
                      : `${c.values.supplyTemp.toFixed(1)}°C`}
                  </span>
                </div>
                <div className="rounded-lg bg-[#f4f7fc] px-2 py-1">
                  <span className="block text-[8px] font-bold uppercase tracking-wider text-slate-400">RH</span>
                  <span className="num block text-[12px] font-bold text-[#12294d]">
                    {c.values.humidity === null || c.values.humidity === undefined
                      ? "—"
                      : `${c.values.humidity.toFixed(0)}%`}
                  </span>
                </div>
              </Link>

              <div className="flex items-center justify-between gap-1.5 border-t border-[#eef2f7] pt-1.5">
                {canControl ? (
                  <ControlPanel
                    ahuId={c.ahu.id}
                    status={c.status}
                    canControl={canControl}
                    controlMode={c.ahu.controlMode ?? "AUTO"}
                    setpoint={c.ahu.setpoint ?? 22}
                    desiredRunState={c.ahu.desiredRunState ?? "STOP"}
                    activeCommand={c.activeCommand ?? null}
                    physicalUnlocked={false}
                    onDone={() => void reload()}
                    compact
                  />
                ) : (
                  <span className="font-mono text-[9.5px] text-slate-400">{c.ahu.installedSensors.length}/12 sens</span>
                )}
                <Link
                  href={`/ahu/${c.ahu.id}`}
                  className="inline-flex items-center gap-0.5 rounded-md bg-[#eef4ff] px-2 py-1 text-[10px] font-bold text-[#1d6ef2]"
                >
                  Open <ArrowRight size={11} />
                </Link>
              </div>
            </div>

            {/* Full Tablet/Desktop Card (>= sm) */}
            <div className="panel card-hover hidden h-full flex-col rounded-2xl p-4 sm:flex">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/ahu/${c.ahu.id}`} className="group min-w-0 flex-1">
                  <p className="font-mono text-[14.5px] font-bold text-[#12294d] group-hover:text-[#1d6ef2]">{c.ahu.id}</p>
                  <p className="truncate text-[12px] font-medium text-slate-600">{c.ahu.name}</p>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-slate-400">
                    <MapPin size={10} className="flex-none" /> {c.ahu.location}
                  </p>
                </Link>
                <StatusBadge status={c.status} size="sm" />
              </div>

              <Link href={`/ahu/${c.ahu.id}`} className="mt-3 flex items-center gap-3">
                <div className="relative h-16 w-20 flex-none sm:w-24">
                  <Image
                    src="/ahu/unit-iso.png"
                    alt={`${c.ahu.id} illustration`}
                    fill
                    sizes="96px"
                    className={cx("object-contain", c.status === "OFFLINE" && "opacity-45 grayscale")}
                  />
                </div>
                <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <div className="flex justify-between gap-1.5">
                    <dt className="text-slate-400">Supply</dt>
                    <dd className="num font-semibold text-slate-700">{c.values.supplyTemp?.toFixed(1) ?? "--"} °C</dd>
                  </div>
                  <div className="flex justify-between gap-1.5">
                    <dt className="text-slate-400">Humidity</dt>
                    <dd className="num font-semibold text-slate-700">{c.values.humidity?.toFixed(0) ?? "--"} %</dd>
                  </div>
                  <div className="flex justify-between gap-1.5">
                    <dt className="text-slate-400">Sensors</dt>
                    <dd className="num font-semibold text-slate-700">{c.ahu.installedSensors.length}/12</dd>
                  </div>
                  <div className="flex justify-between gap-1.5">
                    <dt className="text-slate-400">Alarms</dt>
                    <dd className={cx("num font-semibold", c.activeAlarms > 0 ? "text-red-500" : "text-slate-700")}>
                      {c.activeAlarms}
                    </dd>
                  </div>
                </dl>
              </Link>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#f1f5f9] pt-2.5">
                <span className="text-[10px] text-slate-400">
                  {c.lastSeenAt ? `seen ${timeAgo(c.lastSeenAt)}` : "no telemetry"}
                </span>
                <div className="flex items-center gap-2">
                  {canControl ? (
                    <ControlPanel
                      ahuId={c.ahu.id}
                      status={c.status}
                      canControl={canControl}
                      controlMode={c.ahu.controlMode ?? "AUTO"}
                      setpoint={c.ahu.setpoint ?? 22}
                      desiredRunState={c.ahu.desiredRunState ?? "STOP"}
                      activeCommand={c.activeCommand ?? null}
                      physicalUnlocked={false}
                      onDone={() => void reload()}
                      compact
                    />
                  ) : null}
                  <Link
                    href={`/ahu/${c.ahu.id}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#dbe7fb] bg-[#f4f8ff] px-2.5 py-1 text-[11px] font-semibold text-[#1d6ef2] transition hover:bg-[#e8f0fe]"
                  >
                    Details <ArrowRight size={12} />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(data?.cards ?? []).length === 0 ? <Empty>No AHU units registered.</Empty> : null}
    </div>
  );
}
