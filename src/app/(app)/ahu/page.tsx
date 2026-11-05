"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Box,
  CheckCircle2,
  MapPin,
  Plus,
  RotateCw,
  Settings2,
  Sun,
  X,
} from "lucide-react";
import { api, LOCAL_POLL_MS, timeAgo, usePoll } from "@/lib/client";
import { useSessionUser } from "@/components/AppShell";
import ControlPanel from "@/components/ControlPanel";
import type { FacilityAhuItem, PendingPlacement } from "@/components/AhuFacilityMap3D";
import { can } from "@/lib/domain";
import {
  normalizeRotation,
  resolveAhuPlacement,
  resolveWallPhysicsAndSnap,
  suggestCleanPlatformSlot,
} from "@/lib/facility-layout";
import { Btn, Empty, ErrorNote, Field, Spinner, StatusBadge, cx, inputClass } from "@/components/ui";

const AhuFacilityMap3D = dynamic(() => import("@/components/AhuFacilityMap3D"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-[#eaf1fb] text-[#12294d]">
      <Spinner label="Initializing 3D multi-wing facility digital twin…" />
    </div>
  ),
});

interface Card extends FacilityAhuItem {
  activeCommand: { id: string; commandType: string; status: string; expiresAt: string } | null;
}

function suggestNextAhuId(existingIds: string[]): string {
  let maxNum = 7;
  for (const id of existingIds) {
    const m = /^AHU-(\d+)$/i.exec(id.trim());
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
  }
  const next = maxNum + 1;
  return `AHU-${String(next).padStart(2, "0")}`;
}

/** FR-03 / FR-05: Full-screen Light-Mode 3D Facility Digital Twin + sleek animated AHU Fleet List sheet. */
export default function AhuIndexPage() {
  const searchParams = useSearchParams();
  const [listOpen, setListOpen] = useState(() => searchParams?.get("view") === "list");

  useEffect(() => {
    setListOpen(searchParams?.get("view") === "list");
  }, [searchParams]);

  function switchView(showList: boolean) {
    setListOpen(showList);
    if (typeof window !== "undefined") {
      const nextUrl = showList ? "/ahu?view=list" : "/ahu";
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }

  const user = useSessionUser();
  const canControl = user ? can(user.role, "control") : false;
  const canConfigure = user ? can(user.role, "configure") : false;
  const { data, error, loading, reload } = usePoll<{ cards: Card[] }>("/api/overview?lite=1", LOCAL_POLL_MS);

  const [selected3dId, setSelected3dId] = useState<string | null>(null);

  // Add-New-AHU modal + 3D floor / outdoor / wall-snap placement state
  const [addOpen, setAddOpen] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newSetpoint, setNewSetpoint] = useState("22.0");
  const [newHasHeater, setNewHasHeater] = useState(true);
  const [newSimEnabled, setNewSimEnabled] = useState(true);
  const [placement, setPlacement] = useState<PendingPlacement | null>(null);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const cards = useMemo(() => data?.cards ?? [], [data?.cards]);

  const existingCoords = useMemo(() => {
    const acc: Array<{ id: string; x: number; z: number; rotation?: number }> = [];
    for (const c of cards) {
      const p = resolveAhuPlacement(c.ahu, acc);
      acc.push({ id: c.ahu.id, x: p.x, z: p.z, rotation: p.rotation });
    }
    return acc;
  }, [cards]);

  function openAddModal() {
    const suggestedId = suggestNextAhuId(cards.map((c) => c.ahu.id));
    const slot = suggestCleanPlatformSlot(existingCoords, true);
    setNewId(suggestedId);
    setNewName(`${suggestedId} Clean Air Supply`);
    setNewLocation("");
    setNewSetpoint("22.0");
    setNewHasHeater(true);
    setNewSimEnabled(true);
    setPlacement({
      x: slot.x,
      z: slot.z,
      rotation: slot.rotation,
      zoneLabel: slot.zone.label,
      indoor: slot.indoor,
    });
    setCreateErr(null);
    setAddOpen(true);
  }

  function autoPickSlot(preferIndoor: boolean) {
    const slot = suggestCleanPlatformSlot(existingCoords, preferIndoor);
    setPlacement({
      x: slot.x,
      z: slot.z,
      rotation: slot.rotation,
      zoneLabel: slot.zone.label,
      indoor: slot.indoor,
      snappedToWall: !preferIndoor,
    });
  }

  async function handleMoveAhuSave(ahuId: string, next: PendingPlacement) {
    await api(`/api/ahu/${encodeURIComponent(ahuId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        mapX: next.x,
        mapZ: next.z,
        mapRotation: next.rotation,
      }),
    });
    await reload();
  }

  async function submitCreateAhu(e: React.FormEvent) {
    e.preventDefault();
    if (!placement) {
      setCreateErr("Click inside any indoor wing or anywhere outdoors to place the new AHU.");
      return;
    }
    setCreating(true);
    setCreateErr(null);
    try {
      const res = await api<{ ok: boolean; ahu: { id: string } }>("/api/ahu", {
        method: "POST",
        body: JSON.stringify({
          id: newId.trim().toUpperCase(),
          name: newName.trim() || `${newId.trim().toUpperCase()} Air Handling Unit`,
          location: newLocation.trim() || placement.zoneLabel,
          setpoint: Number(newSetpoint) || 22.0,
          hasHeater: newHasHeater,
          provisionSimulator: newSimEnabled,
          mapX: placement.x,
          mapZ: placement.z,
          mapRotation: placement.rotation,
        }),
      });
      setAddOpen(false);
      await reload();
      setSelected3dId(res.ahu.id);
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : "Failed to create AHU unit");
    } finally {
      setCreating(false);
    }
  }

  const addModal = addOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-5"
      onClick={() => !creating && setAddOpen(false)}
    >
      <div
        className="animate-rise max-h-[94dvh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-[#dbe4f0] bg-white p-4 shadow-[0_32px_90px_-20px_rgba(18,41,77,0.45)] sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#1d6ef2]">
              3D Digital Twin Commissioning
            </p>
            <h2 className="mt-0.5 text-[18px] font-bold tracking-tight text-[#12294d] sm:text-[20px]">
              Add New AHU &amp; Place 3D Model
            </h2>
            <p className="text-[11.5px] text-slate-500">
              Drag or click inside any indoor room wing or anywhere outdoors. Solid walls snap flush &amp; block clipping.
            </p>
          </div>
          <button
            type="button"
            disabled={creating}
            onClick={() => setAddOpen(false)}
            aria-label="Close Add AHU modal"
            className="grid h-9 w-9 flex-none place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={(e) => void submitCreateAhu(e)} className="mt-4 space-y-4">
          <ErrorNote message={createErr} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="AHU Identifier" hint="e.g. AHU-08">
              <input
                required
                className={cx(inputClass, "font-mono uppercase")}
                value={newId}
                onChange={(e) => setNewId(e.target.value.toUpperCase())}
                placeholder="AHU-08"
              />
            </Field>
            <Field label="Unit Name">
              <input
                required
                className={inputClass}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="AHU-08 Sterile Suite"
              />
            </Field>
            <Field label="Physical Location" hint="Blank = auto from 3D zone">
              <input
                className={inputClass}
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder={placement?.zoneLabel ?? "Auto from selected 3D position"}
              />
            </Field>
            <Field label="Target Setpoint (°C)">
              <input
                type="number"
                step="0.5"
                min={15}
                max={30}
                className={inputClass}
                value={newSetpoint}
                onChange={(e) => setNewSetpoint(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-[#f8fafd] px-3.5 py-2.5 text-[11.5px]">
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={newHasHeater}
                  onChange={(e) => setNewHasHeater(e.target.checked)}
                  className="h-4 w-4 accent-[#1d6ef2]"
                />
                Heating coil installed
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={newSimEnabled}
                  onChange={(e) => setNewSimEnabled(e.target.checked)}
                  className="h-4 w-4 accent-[#1d6ef2]"
                />
                Auto-provision Simulation Controller
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => autoPickSlot(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-[#cbe0fd] bg-[#eef5ff] px-2.5 py-1 text-[11px] font-semibold text-[#1d6ef2] transition hover:bg-[#dfeeff]"
              >
                <Box size={12} /> Auto Indoor Slot
              </button>
              <button
                type="button"
                onClick={() => autoPickSlot(false)}
                className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
              >
                <Sun size={12} /> Auto Outdoor Slot
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!placement) return;
                  const nextRot = normalizeRotation(placement.rotation + 90);
                  const check = resolveWallPhysicsAndSnap(placement.x, placement.z, existingCoords, {
                    rotation: nextRot,
                    enableWallSnap: true,
                    autoAlignRotation: false,
                    clampVoidToWall: true,
                  });
                  setPlacement({
                    x: check.snappedX,
                    z: check.snappedZ,
                    rotation: check.rotation,
                    zoneLabel: check.zone?.label ?? placement.zoneLabel,
                    indoor: check.indoor,
                    snappedToWall: check.snappedToWall,
                  });
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#12294d] transition hover:bg-slate-100"
              >
                <RotateCw size={12} /> Rotate ({placement?.rotation ?? 0}°)
              </button>
            </div>
          </div>

          <AhuFacilityMap3D
            items={cards}
            mode="placement"
            draftAhuId={newId.trim() || "NEW"}
            draftAhuName={newName.trim() || "New AHU"}
            placement={placement}
            onPlacementChange={setPlacement}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <div className="flex items-center gap-2 text-[12px] text-slate-600">
              <CheckCircle2 size={15} className="text-emerald-600" />
              {placement ? (
                <span>
                  Selected Position:{" "}
                  <strong className="text-[#12294d]">{placement.zoneLabel}</strong>{" "}
                  <span className="font-mono text-[11px] text-slate-500">
                    (X {placement.x}m, Z {placement.z}m · {placement.rotation}°)
                  </span>
                </span>
              ) : (
                <span>Click inside any indoor wing or anywhere outdoors above to set position.</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Btn type="button" variant="ghost" disabled={creating} onClick={() => setAddOpen(false)}>
                Cancel
              </Btn>
              <Btn type="submit" variant="primary" disabled={creating || !placement}>
                <Plus size={14} /> {creating ? "Placing & Creating…" : `Place & Create ${newId.trim() || "AHU"}`}
              </Btn>
            </div>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  if (loading && !data) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#eaf1fb]">
        <Spinner label="Loading AHU fleet…" />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#eaf1fb]">
      {/* Persistent Full-Viewport 3D Facility Digital Twin (never unmounted when opening Fleet List -> 0ms blink!) */}
      <AhuFacilityMap3D
        items={cards}
        mode="explore"
        fullPage
        selectedAhuId={selected3dId}
        onSelectAhu={setSelected3dId}
        onOpenList={() => switchView(true)}
        canAddAhu={canConfigure}
        onRequestAddAhu={openAddModal}
        canMoveAhu={canControl || canConfigure}
        onMoveAhuSave={handleMoveAhuSave}
      />

      {/* Sleek Animated AHU Fleet List Sheet Overlay (smooth fade + glide transition, zero page blink) */}
      <div
        aria-hidden={!listOpen}
        className={cx(
          "absolute inset-0 z-30 overflow-y-auto overscroll-contain bg-[#eef3fa]/96 backdrop-blur-xl transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          listOpen
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-4 opacity-0",
        )}
      >
        <div className="mx-auto max-w-[1600px] space-y-4 px-3.5 py-4 sm:space-y-5 sm:px-6 sm:py-6 lg:px-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#12294d] sm:text-[22px]">
                AHU Units · Fleet List
              </h2>
              <p className="text-[12px] text-slate-500">
                All provisioned air handling units · live status, sensors, and control (FR-05)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => switchView(false)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#9ec2fb] bg-white px-3.5 py-2 text-[12px] font-bold text-[#1d6ef2] shadow-[0_2px_8px_-4px_rgba(29,110,242,0.3)] transition hover:border-[#60a5fa] hover:bg-[#f0f6ff]"
              >
                <Box size={14} /> Back to 3D Facility Room
              </button>

              {canConfigure ? (
                <button
                  type="button"
                  onClick={openAddModal}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#2563eb] to-[#1d6ef2] px-3.5 py-2 text-[12px] font-bold text-white shadow-[0_10px_22px_-8px_rgba(37,99,235,0.85)] transition hover:brightness-105"
                >
                  <Plus size={15} /> Add New AHU
                </button>
              ) : null}
            </div>
          </div>

          <ErrorNote message={error} />

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
            {cards.map((c) => (
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
                      <p className="font-mono text-[14.5px] font-bold text-[#12294d] group-hover:text-[#1d6ef2]">
                        {c.ahu.id}
                      </p>
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
                    <div className="flex items-center gap-1.5">
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
                      <button
                        type="button"
                        onClick={() => {
                          setSelected3dId(c.ahu.id);
                          switchView(false);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#dbe7fb] bg-[#f4f8ff] px-2 py-1 text-[11px] font-semibold text-[#1d6ef2] transition hover:bg-[#e8f0fe]"
                        title="Locate in 3D Facility Room"
                      >
                        <Box size={11} /> 3D
                      </button>
                      <Link
                        href={`/config?ahu=${encodeURIComponent(c.ahu.id)}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100"
                      >
                        <Settings2 size={11} /> Config
                      </Link>
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

          {cards.length === 0 ? <Empty>No AHU units registered.</Empty> : null}

          <footer className="flex flex-col items-start justify-between gap-2 pt-3 text-[11px] text-slate-500 sm:flex-row sm:items-center">
            <span>© 2026 Smart Monitoring AHU. All rights reserved.</span>
            <span>Safer Air | Smarter Buildings | A Cleaner Tomorrow</span>
          </footer>
        </div>
      </div>

      {addModal}
    </div>
  );
}
