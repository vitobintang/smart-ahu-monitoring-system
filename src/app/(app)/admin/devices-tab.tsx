"use client";

import { useState, type FormEvent } from "react";
import { Check, Copy, HardDrive, KeyRound, ShieldAlert, Trash2 } from "lucide-react";
import { api, fmtDateTime, usePoll } from "@/lib/client";
import { AHU_IDS } from "@/lib/domain";
import { Btn, Empty, ErrorNote, Field, QualityTag, cx, inputClass } from "@/components/ui";

interface DeviceRow {
  id: string;
  ahuId: string;
  label: string;
  sourceType: "PHYSICAL" | "SIMULATION";
  enabled: boolean;
  createdAt: string;
}

export default function DevicesTab() {
  const devices = usePoll<{ devices: DeviceRow[]; physicalControlUnlocked: boolean }>("/api/devices", 30000);
  const ahuList = usePoll<{ ahus: Array<{ id: string }> }>("/api/ahu", 30000);
  const registeredAhuIds = ahuList.data?.ahus?.length ? ahuList.data.ahus.map((a) => a.id) : [...AHU_IDS];

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devAhu, setDevAhu] = useState<string>(AHU_IDS[0]);
  const [devLabel, setDevLabel] = useState("");
  const [devSource, setDevSource] = useState<"PHYSICAL" | "SIMULATION">("PHYSICAL");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  async function copyTokenToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2500);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function provisionDevice(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setCopiedToken(false);
    try {
      const res = await api<{ device: DeviceRow & { token: string } }>("/api/devices", {
        method: "POST",
        body: JSON.stringify({ ahuId: devAhu, label: devLabel || undefined, sourceType: devSource }),
      });
      setIssuedToken(res.device.token);
      setNotice(`AHU monitoring module provisioned for ${devAhu}. Copy the bearer token below (FR-21).`);
      setDevLabel("");
      await devices.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Module provisioning failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDevice(d: DeviceRow) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/devices", { method: "POST", body: JSON.stringify({ deviceId: d.id, enabled: !d.enabled }) });
      await devices.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Module update failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice(d: DeviceRow) {
    const confirmed = window.confirm(
      `Remove module "${d.label}" from ${d.ahuId}?

Its bearer token will be permanently revoked.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/devices?deviceId=${encodeURIComponent(d.id)}`, { method: "DELETE" });
      setNotice(`Removed module "${d.label}" (${d.ahuId}).`);
      await devices.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove module");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ErrorNote message={error || devices.error} />
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900">
          {notice}
        </div>
      ) : null}
        <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
          {/* Provisioned AHU Monitoring Modules */}
          <div className="panel overflow-hidden rounded-2xl">
            <div className="border-b border-[#e4eaf3] bg-[#f8fafd] px-4 py-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#12294d]">
                Provisioned AHU Monitoring Modules ({devices.data?.devices.length ?? 0})
              </h2>
              <p className="text-[11px] text-[#475569]">
                Bearer tokens are dedicated exclusively to AHU telemetry ingestion gateways (FR-21)
              </p>
            </div>

            {/* Mobile stacked module cards */}
            <div className="divide-y divide-[#eef2f7] md:hidden">
              {(devices.data?.devices ?? []).map((d) => (
                <div key={d.id} className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm font-bold text-[#12294d]">{d.ahuId}</p>
                      <p className="text-xs font-medium text-[#334155]">{d.label}</p>
                    </div>
                    <span
                      className={cx(
                        "rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase ring-1 ring-inset",
                        d.enabled
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-300"
                          : "bg-slate-100 text-slate-600 ring-slate-300",
                      )}
                    >
                      {d.enabled ? "enabled" : "disabled"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1.5">
                      <QualityTag quality={d.sourceType === "SIMULATION" ? "SIMULATED" : "OK"} title={d.sourceType} />
                      <span className="font-mono text-[10.5px] font-semibold text-[#475569]">{d.sourceType}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Btn size="sm" variant="default" onClick={() => void toggleDevice(d)} disabled={busy}>
                        {d.enabled ? "Disable" : "Enable"}
                      </Btn>
                      <Btn
                        size="sm"
                        variant="danger"
                        onClick={() => void removeDevice(d)}
                        disabled={busy}
                        title={`Remove ${d.label}`}
                      >
                        <Trash2 size={12} /> Remove
                      </Btn>
                    </div>
                  </div>
                </div>
              ))}
              {devices.data?.devices.length === 0 ? (
                <div className="p-6">
                  <Empty>No AHU monitoring modules provisioned yet.</Empty>
                </div>
              ) : null}
            </div>

            {/* Desktop / Tablet module table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#e4eaf3] bg-[#f8fafd] text-[10px] font-bold uppercase tracking-wider text-[#475569]">
                  <tr>
                    <th className="px-4 py-2.5">AHU</th>
                    <th className="px-4 py-2.5">Module Label</th>
                    <th className="px-4 py-2.5">Source (FR-09)</th>
                    <th className="px-4 py-2.5">Token</th>
                    <th className="px-4 py-2.5">State</th>
                    <th className="px-4 py-2.5">Created</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {(devices.data?.devices ?? []).map((d) => (
                    <tr key={d.id} className="hover:bg-[#f6f9fd]">
                      <td className="px-4 py-2.5 font-mono font-bold text-[#12294d]">{d.ahuId}</td>
                      <td className="px-4 py-2.5 font-medium text-[#334155]">{d.label}</td>
                      <td className="px-4 py-2.5">
                        <QualityTag quality={d.sourceType === "SIMULATION" ? "SIMULATED" : "OK"} title={d.sourceType} />
                        <span className="ml-1.5 font-mono text-[10.5px] font-semibold text-[#475569]">{d.sourceType}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[#475569]">Hidden after issuance</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cx(
                            "rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ring-1 ring-inset",
                            d.enabled
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-300"
                              : "bg-slate-100 text-slate-600 ring-slate-300",
                          )}
                        >
                          {d.enabled ? "enabled" : "disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-[#475569]">{fmtDateTime(d.createdAt)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Btn size="sm" variant="default" onClick={() => void toggleDevice(d)} disabled={busy}>
                            {d.enabled ? "Disable" : "Enable"}
                          </Btn>
                          <Btn
                            size="sm"
                            variant="danger"
                            onClick={() => void removeDevice(d)}
                            disabled={busy}
                            title={`Remove ${d.label}`}
                          >
                            <Trash2 size={12} /> Remove
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {devices.data?.devices.length === 0 ? (
                <div className="p-6">
                  <Empty>No AHU monitoring modules provisioned yet.</Empty>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <form onSubmit={provisionDevice} className="panel h-max rounded-2xl p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#12294d]">
                <KeyRound size={14} className="text-[#1d6ef2]" /> Register AHU Module
              </h2>
              <p className="mt-1 text-[11px] leading-relaxed text-[#475569]">
                Issues a dedicated bearer token for an AHU monitoring module to push live telemetry.
              </p>
              <div className="mt-3 space-y-3">
                <Field label="AHU identity">
                  <select
                    className={inputClass}
                    value={registeredAhuIds.includes(devAhu) ? devAhu : registeredAhuIds[0]}
                    onChange={(e) => setDevAhu(e.target.value)}
                  >
                    {registeredAhuIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Module label">
                  <input
                    className={inputClass}
                    value={devLabel}
                    placeholder="e.g. Rooftop ESP32 / BMS gateway"
                    onChange={(e) => setDevLabel(e.target.value)}
                  />
                </Field>
                <Field label="Source type" hint="FR-09 source identifier written with every telemetry row">
                  <select
                    className={inputClass}
                    value={devSource}
                    onChange={(e) => setDevSource(e.target.value as "PHYSICAL" | "SIMULATION")}
                  >
                    <option value="PHYSICAL">PHYSICAL (Hardware Gateway)</option>
                    <option value="SIMULATION">SIMULATION (Virtual Controller)</option>
                  </select>
                </Field>
                <Btn type="submit" variant="primary" disabled={busy} className="w-full py-2">
                  <HardDrive size={13} /> Provision &amp; issue module token
                </Btn>
              </div>
            </form>

            {issuedToken ? (
              <div className="panel rounded-2xl border-emerald-200 bg-emerald-50/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                    Issued AHU Module Token
                  </p>
                  <Btn size="sm" variant="default" onClick={() => void copyTokenToClipboard(issuedToken)}>
                    {copiedToken ? <Check size={12} /> : <Copy size={12} />}
                    {copiedToken ? "Copied" : "Copy"}
                  </Btn>
                </div>
                <code className="mt-2 block break-all rounded-lg border border-emerald-200 bg-white p-2 font-mono text-[11px] font-semibold text-emerald-900">
                  {issuedToken}
                </code>
                <p className="mt-2 text-[10.5px] leading-relaxed text-[#334155]">
                  Save this token now (shown once). Send as{" "}
                  <span className="font-mono font-semibold text-[#0f172a]">Authorization: Bearer &lt;token&gt;</span> on{" "}
                  <span className="font-mono font-semibold text-[#0f172a]">POST /api/telemetry</span>.
                </p>
              </div>
            ) : null}

            <div className="panel rounded-2xl border-amber-200 bg-amber-50/90 p-4 text-[11px] leading-relaxed text-amber-950">
              <p className="flex items-center gap-2 font-bold uppercase tracking-wide text-amber-900">
                <ShieldAlert size={13} className="text-amber-600" /> Physical control{" "}
                {devices.data?.physicalControlUnlocked ? "unlocked" : "locked"}
              </p>
              <p className="mt-1">
                Physical commands are disabled until a commissioned physical controller integration is verified. Local
                hardware safety interlocks must remain active; the web interface is not an emergency stop.
              </p>
            </div>
          </div>
        </div>
    </>
  );
}
