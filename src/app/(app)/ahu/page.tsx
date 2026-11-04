"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, MapPin } from "lucide-react";
import type { AhuStatus } from "@/db/schema";
import { LOCAL_POLL_MS, timeAgo, usePoll } from "@/lib/client";
import { Empty, ErrorNote, Spinner, StatusBadge, cx } from "@/components/ui";

interface Card {
  ahu: { id: string; name: string; location: string; hasHeater: boolean; installedSensors: string[]; setpoint: number; controlMode: string };
  status: AhuStatus;
  lastSeenAt: string | null;
  source: string | null;
  values: Record<string, number | null>;
  activeAlarms: number;
  unackedAlarms: number;
}

/** FR-03 / FR-05: fleet index of all AHU units. */
export default function AhuIndexPage() {
  const { data, error, loading } = usePoll<{ cards: Card[] }>("/api/overview", LOCAL_POLL_MS);

  if (loading && !data) return <Spinner label="Loading AHU fleet…" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#12294d]">AHU Units</h1>
        <p className="text-[12px] text-slate-500">
          All provisioned air handling units · identity, location, installed sensors and live status (FR-05)
        </p>
      </div>

      <ErrorNote message={error} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(data?.cards ?? []).map((c) => (
          <Link key={c.ahu.id} href={`/ahu/${c.ahu.id}`} className="panel card-hover group rounded-2xl p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[14px] font-bold text-[#12294d]">{c.ahu.id}</p>
                <p className="truncate text-[12px] font-medium text-slate-600">{c.ahu.name}</p>
                <p className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-slate-400">
                  <MapPin size={10} /> {c.ahu.location}
                </p>
              </div>
              <StatusBadge status={c.status} size="sm" />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <div className="relative h-16 w-24 flex-none">
                <Image
                  src="/ahu/unit-iso.png"
                  alt={`${c.ahu.id} illustration`}
                  fill
                  sizes="96px"
                  className={cx("object-contain", c.status === "OFFLINE" && "opacity-45 grayscale")}
                />
              </div>
              <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Supply</dt>
                  <dd className="num font-semibold text-slate-700">{c.values.supplyTemp?.toFixed(1) ?? "--"} °C</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Humidity</dt>
                  <dd className="num font-semibold text-slate-700">{c.values.humidity?.toFixed(0) ?? "--"} %</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Sensors</dt>
                  <dd className="num font-semibold text-slate-700">{c.ahu.installedSensors.length}/12</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Alarms</dt>
                  <dd className={cx("num font-semibold", c.activeAlarms > 0 ? "text-red-500" : "text-slate-700")}>{c.activeAlarms}</dd>
                </div>
              </dl>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-[#f1f5f9] pt-2.5">
              <span className="text-[10px] text-slate-400">{c.lastSeenAt ? `seen ${timeAgo(c.lastSeenAt)}` : "no telemetry"}</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1d6ef2] group-hover:underline">
                Open unit <ArrowRight size={12} />
              </span>
            </div>
          </Link>
        ))}
      </div>

      {(data?.cards ?? []).length === 0 ? <Empty>No AHU units registered.</Empty> : null}
    </div>
  );
}