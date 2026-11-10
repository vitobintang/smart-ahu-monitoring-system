"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Save, Settings2, ShieldAlert } from "lucide-react";
import { api, usePoll } from "@/lib/client";
import { AHU_IDS, PARAMETERS, type ParamKey } from "@/lib/domain";
import { Btn, Empty, ErrorNote, Field, Spinner, cx, inputClass } from "@/components/ui";

interface Threshold {
  id?: string;
  ahuId?: string;
  parameter: string;
  enabled: boolean;
  lowLimit: number | null;
  highLimit: number | null;
  delaySec: number;
  priority: string;
  trendEnabled: boolean;
  unit: string | null;
  label: string | null;
  validMin: number | null;
  validMax: number | null;
}

interface Detail {
  ahu: {
    id: string;
    name: string;
    location: string;
    commTimeoutSec: number;
    hasHeater: boolean;
    installedSensors: string[];
  };
  thresholds: Threshold[];
}

export default function ConfigPage() {
  const searchParams = useSearchParams();
  const requestedAhu = searchParams?.get("ahu")?.trim() || null;
  const [selected, setSelected] = useState<string>(requestedAhu || AHU_IDS[0]);
  const { data: ahuListData } = usePoll<{ ahus: Array<{ id: string; name: string }> }>("/api/ahu", 30000);
  const unitIds = ahuListData?.ahus?.length ? ahuListData.ahus.map((a) => a.id) : [...AHU_IDS];
  // Follow the ACTIVE device fleet: if the selected unit belongs to the inactive
  // source (e.g. Daikin unit while My DB is active), fall back to the fleet head.
  const effectiveSelected = unitIds.includes(selected) ? selected : unitIds[0];
  const { data, error, loading, reload } = usePoll<Detail>(`/api/ahu/${effectiveSelected}`, 30000);
  const { data: session } = usePoll<{ user: { role: string } | null }>("/api/auth/session", 60000);
  const canEdit = session?.user ? ["Admin", "Engineering"].includes(session.user.role) : false;

  useEffect(() => {
    if (requestedAhu) setSelected(requestedAhu);
  }, [requestedAhu]);

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [timeout, setTimeoutSec] = useState(30);
  const [hasHeater, setHasHeater] = useState(false);
  const [sensors, setSensors] = useState<string[]>([]);
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setName(data.ahu.name);
    setLocation(data.ahu.location);
    setTimeoutSec(data.ahu.commTimeoutSec);
    setHasHeater(data.ahu.hasHeater);
    setSensors(data.ahu.installedSensors);
    setThresholds(data.thresholds);
    setNotice(null);
    setSaveError(null);
  }, [data]);

  function patchThreshold(param: string, patch: Partial<Threshold>) {
    setThresholds((rows) =>
      rows.map((r) => (r.parameter === param ? { ...r, ...patch } : r)),
    );
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      await api(`/api/ahu/${effectiveSelected}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          location,
          commTimeoutSec: timeout,
          hasHeater,
          installedSensors: sensors,
          thresholds: thresholds.map((t) => ({
            parameter: t.parameter,
            enabled: t.enabled,
            lowLimit: t.lowLimit,
            highLimit: t.highLimit,
            delaySec: t.delaySec,
            priority: t.priority,
            trendEnabled: t.trendEnabled,
          })),
        }),
      });
      setNotice("Configuration saved. The change was written to the audit log (FR-29).");
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <Spinner label="Loading configuration…" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">
            <Settings2 size={20} className="text-cyan-300" /> AHU &amp; Sensor Configuration
          </h1>
          <p className="text-xs text-slate-500">
            FR-19 · editable by Admin and Engineering only · identity, location, installed sensor checklist,
            communication timeout and parameter alarm thresholds
          </p>
        </div>
        {canEdit ? (
          <Btn variant="primary" onClick={() => void save()} disabled={saving}>
            <Save size={13} /> {saving ? "Saving…" : "Save configuration"}
          </Btn>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            <ShieldAlert size={13} /> Read-only — your role may not modify configurations (NFR-03)
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <div className="panel h-max rounded-2xl p-3">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Units</p>
            <Link href={`/devices/${effectiveSelected}`} className="font-mono text-[10.5px] font-semibold uppercase tracking-wide text-cyan-300 hover:underline lg:hidden">
              view {effectiveSelected} →
            </Link>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
            {unitIds.map((id) => (
              <div
                key={id}
                className={cx(
                  "flex flex-none items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition lg:w-full",
                  effectiveSelected === id
                    ? "border-cyan-500/50 bg-cyan-500/12 text-cyan-100"
                    : "border-ink-700/60 text-slate-400 hover:border-ink-600 hover:text-slate-200 lg:border-transparent",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelected(id)}
                  className="flex-1 text-left font-mono font-semibold"
                >
                  {id}
                </button>
                <Link href={`/devices/${id}`} className="ml-2 hidden text-[10px] uppercase tracking-wide opacity-70 hover:opacity-100 lg:inline">
                  view
                </Link>
              </div>
            ))}
          </div>
        </div>

        {!data ? (
          <Empty>{error ?? "Configuration unavailable."}</Empty>
        ) : (
          <div className="space-y-4">
            <ErrorNote message={error ?? saveError} />
            {notice ? (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">{notice}</p>
            ) : null}

            <div className="panel rounded-2xl p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-100">Unit identity</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="AHU name">
                  <input className={inputClass} value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Physical location">
                  <input className={inputClass} value={location} disabled={!canEdit} onChange={(e) => setLocation(e.target.value)} />
                </Field>
                <Field label="Communication timeout (seconds)" hint="FR-04 OFFLINE detection threshold">
                  <input
                    type="number"
                    min={5}
                    max={3600}
                    className={inputClass}
                    value={timeout}
                    disabled={!canEdit}
                    onChange={(e) => setTimeoutSec(Number(e.target.value))}
                  />
                </Field>
                <Field label="Heating coil installed" hint="FR-07 renders the heating coil only when installed">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-950/70 px-3 py-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={hasHeater}
                      disabled={!canEdit}
                      onChange={(e) => {
                        setHasHeater(e.target.checked);
                        if (!e.target.checked) setSensors((s) => s.filter((x) => x !== "heaterOutput"));
                        else setSensors((s) => (s.includes("heaterOutput") ? s : [...s, "heaterOutput"]));
                      }}
                      className="h-4 w-4 accent-cyan-500"
                    />
                    hasHeater = {String(hasHeater)}
                  </label>
                </Field>
              </div>
            </div>

            <div className="panel rounded-2xl p-4">
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-100">Installed sensor checklist</h2>
              <p className="mb-3 text-[11px] text-slate-500">
                FR-06 supports up to 12 parameters; per-unit availability depends on this checklist. Unchecked
                parameters are reported as <span className="font-mono text-slate-400">UNINSTALLED</span> (NFR-06).
              </p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {PARAMETERS.map((p) => {
                  const checked = sensors.includes(p.key);
                  const locked = p.key === "heaterOutput" && !hasHeater;
                  return (
                    <label
                      key={p.key}
                      className={cx(
                        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs transition",
                        checked ? "border-cyan-500/40 bg-cyan-500/8 text-slate-100" : "border-ink-700 bg-ink-900/40 text-slate-400",
                        locked && "opacity-40",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-cyan-500"
                        checked={checked}
                        disabled={!canEdit || locked}
                        onChange={(e) =>
                          setSensors((s) => (e.target.checked ? [...s, p.key] : s.filter((x) => x !== p.key)))
                        }
                      />
                      <span>
                        <span className="block font-medium">{p.label}</span>
                        <span className="block font-mono text-[10px] text-slate-500">
                          {p.key} · {p.localLabel.toLowerCase()} · {p.unit} · range {p.validMin}…{p.validMax}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="panel overflow-hidden rounded-2xl">
              <header className="border-b border-ink-700/70 px-5 py-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">Parameter alarm thresholds</h2>
                <p className="text-[11px] text-slate-500">
                  FR-13 lower/upper limits, activation delay (seconds) and priority · FR-16 trend monitoring flag
                </p>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead className="bg-ink-900/60 text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Parameter</th>
                      <th className="px-3 py-2 text-center">Enabled</th>
                      <th className="px-3 py-2">Low limit</th>
                      <th className="px-3 py-2">High limit</th>
                      <th className="px-3 py-2">Delay (s)</th>
                      <th className="px-3 py-2">Priority</th>
                      <th className="px-3 py-2 text-center">Trend</th>
                      <th className="px-3 py-2">Valid range</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-800/70">
                    {thresholds.map((t, ti) => {
                      const meta = PARAMETERS.find((p) => p.key === (t.parameter as ParamKey));
                      return (
                        <tr key={`${t.ahuId ?? ""}:${t.parameter}:${t.id ?? ti}`}>
                          <td className="px-3 py-2">
                            <span className="text-slate-200">{t.label ?? meta?.label ?? t.parameter}</span>
                            <span className="ml-2 font-mono text-[10px] text-slate-500">{t.parameter}</span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={t.enabled} disabled={!canEdit} onChange={(e) => patchThreshold(t.parameter, { enabled: e.target.checked })} />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              step="0.1"
                              className={cx(inputClass, "w-24 py-1 font-mono")}
                              value={t.lowLimit ?? ""}
                              disabled={!canEdit}
                              onChange={(e) => patchThreshold(t.parameter, { lowLimit: e.target.value === "" ? null : Number(e.target.value) })}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              step="0.1"
                              className={cx(inputClass, "w-24 py-1 font-mono")}
                              value={t.highLimit ?? ""}
                              disabled={!canEdit}
                              onChange={(e) => patchThreshold(t.parameter, { highLimit: e.target.value === "" ? null : Number(e.target.value) })}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              max={600}
                              className={cx(inputClass, "w-20 py-1 font-mono")}
                              value={t.delaySec}
                              disabled={!canEdit}
                              onChange={(e) => patchThreshold(t.parameter, { delaySec: Number(e.target.value) })}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              className={cx(inputClass, "w-28 py-1")}
                              value={t.priority}
                              disabled={!canEdit}
                              onChange={(e) => patchThreshold(t.parameter, { priority: e.target.value })}
                            >
                              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" className="h-4 w-4 accent-violet-500" checked={t.trendEnabled} disabled={!canEdit} onChange={(e) => patchThreshold(t.parameter, { trendEnabled: e.target.checked })} />
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] text-slate-500">
                            {t.validMin ?? meta?.validMin} … {t.validMax ?? meta?.validMax} {t.unit ?? meta?.unit}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}