"use client";

import Image from "next/image";
import { FileCheck2 } from "lucide-react";
import { fmtDateTime, type SessionUser } from "@/lib/client";
import { PARAMETERS, type DataQuality, type ParamKey } from "@/lib/domain";
import { QualityTag, SourceTag, cx } from "@/components/ui";
import {
  FormalKpi,
  MECH_ELEC_PARAMS,
  PARAM_SHORT_HEADER,
  SectionHeading,
  SignatureBox,
  SpecCell,
  THERMAL_AIR_PARAMS,
  VectorTrendChart,
  fmtBucketTs,
  fmtCompactTs,
  sampleFlags,
  type Orientation,
  type PaperSize,
  type Report,
} from "./report-sheet-parts";

interface ReportSheetProps {
  report: Report;
  docRef: string;
  preparedByName: string;
  sessionUser: SessionUser | null;
  generatedAt: Date | null;
  paperSize: PaperSize;
  orientation: Orientation;
  isWideFormat: boolean;
  sheetMaxWidth: number | undefined;
  rangeDays: number;
  chartRows: Array<Record<string, number | null>>;
  displayedSamples: Array<Record<string, unknown> & { timestamp: string }>;
  fallbackTotal: number;
  executiveSummary: string;
  includeIntervals: boolean;
  includeSamples: boolean;
}

export default function ReportSheet({
  report,
  docRef,
  preparedByName,
  sessionUser,
  generatedAt,
  paperSize,
  orientation,
  isWideFormat,
  sheetMaxWidth,
  rangeDays,
  chartRows,
  displayedSamples,
  fallbackTotal,
  executiveSummary,
  includeIntervals,
  includeSamples,
}: ReportSheetProps) {
  return (
        <article
          style={sheetMaxWidth ? { maxWidth: `${sheetMaxWidth}px` } : undefined}
          className="report-sheet mx-auto w-full overflow-hidden rounded-2xl border border-[#cfd9e6] bg-white text-[#0f172a] shadow-[0_20px_60px_-24px_rgba(15,23,42,0.28)]"
        >
          {/* Top formal authority bar */}
          <div className="h-2 w-full bg-linear-to-r from-[#0b1f3f] via-[#163a70] to-[#1d6ef2]" />

          <div className="space-y-6 p-4 sm:p-7 md:p-9">
            {/* MASTHEAD & CONTROLLED DOCUMENT STAMP */}
            <header className="avoid-break border-b-2 border-[#0b1f3f] pb-5">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div className="flex items-start gap-3.5">
                  <div className="relative h-12 w-12 flex-none overflow-hidden rounded-xl border border-[#cbd5e1] bg-[#0b1f3f] shadow-xs">
                    <Image src="/ahu/logo.png" alt="Smart Monitoring AHU" fill sizes="48px" className="object-cover" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-[#1d6ef2]">
                      Smart Monitoring AHU · Building Automation &amp; HVAC Telemetry Division
                    </p>
                    <h2 className="mt-0.5 text-[17px] font-extrabold tracking-[-0.015em] text-[#0b1f3f] sm:text-[20px]">
                      AIR HANDLING UNIT OPERATIONAL &amp; TELEMETRY REPORT
                    </h2>
                    <p className="mt-0.5 text-[11px] text-[#475569]">
                      Controlled Engineering Record · Historical Performance, Statistical Analysis &amp; Data-Quality
                      Audit (FR-10 / FR-11 / FR-12)
                    </p>
                  </div>
                </div>

                {/* Formal Document Control Stamp */}
                <div className="w-full shrink-0 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-2.5 text-[10.5px] md:w-64">
                  <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-1">
                    <span className="font-bold uppercase tracking-wider text-[#475569]">Doc. Ref</span>
                    <span className="font-mono font-bold text-[#0b1f3f]">{docRef}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[#475569]">Page Format</span>
                    <span className="font-mono font-semibold text-[#0f172a]">
                      {paperSize} · {orientation === "portrait" ? "Portrait" : "Landscape"}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <span className="text-[#475569]">Generated</span>
                    <span className="font-mono text-[#0f172a]">{fmtDateTime(generatedAt ?? new Date())}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <span className="text-[#475569]">Classification</span>
                    <span className="font-semibold text-[#166534]">CONTROLLED RECORD</span>
                  </div>
                </div>
              </div>

              {/* Equipment & Scope Specification Grid */}
              <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-[#cbd5e1] bg-[#cbd5e1] text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                <SpecCell
                  label="Equipment Designation"
                  value={`${report.ahuId} — ${report.ahuName}`}
                  mono
                />
                <SpecCell
                  label="Facility Zone / Location"
                  value={report.ahuLocation ?? "Main Mechanical Plant"}
                />
                <SpecCell
                  label="Operating Mode & Setpoint"
                  value={`${report.controlMode ?? "AUTO"} · ${(report.setpoint ?? 22).toFixed(1)} °C`}
                  mono
                />
                <SpecCell
                  label="Commissioned Sensors"
                  value={`${report.installedSensorCount ?? report.stats.filter((s) => s.installed).length} / 12 active · timeout ${report.commTimeoutSec ?? 30}s`}
                  mono
                />
                <SpecCell
                  label="Reporting Period Start"
                  value={fmtDateTime(report.from)}
                  mono
                />
                <SpecCell
                  label="Reporting Period End"
                  value={fmtDateTime(report.to)}
                  mono
                />
                <SpecCell
                  label="Telemetry Source Filter"
                  value={`${report.source} (FR-09)`}
                  mono
                />
                <SpecCell
                  label="Aggregation Interval"
                  value={`${report.bucketLabel} (${report.buckets.length} buckets)`}
                />
              </div>
            </header>

            {/* SECTION 1: EXECUTIVE OPERATIONAL SUMMARY */}
            <section className="avoid-break space-y-3">
              <SectionHeading
                number="01"
                title="Executive Operational Summary"
                right={`Window Duration: ${(rangeDays * 24).toFixed(1)} hours (${rangeDays.toFixed(2)} days)`}
              />

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                <FormalKpi
                  label="Valid Samples"
                  value={report.totalRows.toLocaleString()}
                  sub={`${report.bucketLabel}`}
                  tone="navy"
                />
                <FormalKpi
                  label="RUN Duty Factor"
                  value={`${(report.runProportion * 100).toFixed(1)}%`}
                  sub={`${report.runSamples.toLocaleString()} RUN rows`}
                  tone="emerald"
                />
                <FormalKpi
                  label="Physical Rows"
                  value={report.physicalRows.toLocaleString()}
                  sub="source = PHYSICAL"
                  tone="blue"
                />
                <FormalKpi
                  label="Simulated Rows"
                  value={report.simulationRows.toLocaleString()}
                  sub="source = SIMULATION"
                  tone="violet"
                />
                <FormalKpi
                  label="Sentinel Flags"
                  value={String(fallbackTotal)}
                  sub="NFR-06.5 excluded"
                  tone={fallbackTotal > 0 ? "amber" : "slate"}
                  className="col-span-2 sm:col-span-1"
                />
              </div>

              <div className="rounded-lg border border-[#d5dfec] bg-[#f8fafd] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-[#1e293b]">
                <span className="mr-1.5 font-bold uppercase tracking-wider text-[#0b1f3f]">Engineering Assessment:</span>
                {executiveSummary}
              </div>
            </section>

            {/* SECTION 2: PARAMETER STATISTICAL SUMMARY (100% Portrait & Landscape Safe) */}
            <section className="space-y-2.5">
              <SectionHeading
                number="02"
                title="Process Parameter Statistical Summary"
                right="12 Monitored Variables · NFR-06 Verified"
              />

              <div className="overflow-x-auto rounded-lg border border-[#cbd5e1]">
                <table className="report-table w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-[#94a3b8] bg-[#eef3f9] text-[9.5px] font-bold uppercase tracking-wider text-[#0b1f3f]">
                      <th className="px-2.5 py-2 text-center">#</th>
                      <th className="px-2.5 py-2">Process Parameter</th>
                      <th className="px-2 py-2">Unit</th>
                      <th className="px-2.5 py-2 text-right">Mean</th>
                      <th className="px-2.5 py-2 text-right">Min</th>
                      <th className="px-2.5 py-2 text-right">Max</th>
                      <th className="px-2.5 py-2 text-right">Δ Span</th>
                      <th className="px-2.5 py-2 text-right">Samples</th>
                      <th className="px-2.5 py-2">Data Clarity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2e8f0]">
                    {report.stats.map((s, idx) => {
                      const meta = PARAMETERS.find((p) => p.key === s.parameter)!;
                      const span =
                        s.min !== null && s.max !== null ? (s.max - s.min).toFixed(meta.decimals) : "—";
                      const quality: DataQuality = !s.installed
                        ? "UNINSTALLED"
                        : s.count === 0
                          ? "NULL_UNAVAILABLE"
                          : s.fallbackCount > 0
                            ? "ESTIMATED_FALLBACK"
                            : report.simulationRows > 0 && report.physicalRows === 0
                              ? "SIMULATED"
                              : "OK";
                      return (
                        <tr
                          key={s.parameter}
                          className={cx(
                            idx % 2 === 1 ? "bg-[#f8fafc]" : "bg-white",
                            !s.installed && "text-[#64748b]",
                          )}
                        >
                          <td className="px-2.5 py-1.5 text-center font-mono text-[10px] text-[#64748b]">
                            {String(idx + 1).padStart(2, "0")}
                          </td>
                          <td className="px-2.5 py-1.5">
                            <span className="font-semibold text-[#0f172a]">{s.label}</span>
                            <span className="ml-1.5 hidden font-mono text-[9.5px] text-[#64748b] sm:inline">
                              ({meta.localLabel.toLowerCase()})
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10.5px] text-[#475569]">
                            {s.unit}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono font-bold tabular-nums text-[#0b1f3f]">
                            {s.avg === null ? "—" : s.avg.toFixed(meta.decimals)}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono tabular-nums text-[#334155]">
                            {s.min === null ? "—" : s.min.toFixed(meta.decimals)}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono tabular-nums text-[#334155]">
                            {s.max === null ? "—" : s.max.toFixed(meta.decimals)}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono tabular-nums text-[#475569]">
                            {span}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono tabular-nums text-[#334155]">
                            {s.count.toLocaleString()}
                            {s.fallbackCount > 0 ? (
                              <span className="ml-1 text-[9.5px] font-semibold text-fuchsia-700">
                                (+{s.fallbackCount} fb)
                              </span>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-1.5">
                            <QualityTag quality={quality} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* SECTION 3: VECTOR GRAPHICAL TREND PROFILES (Zero Clipping on Any Paper/Viewport) */}
            <section className="avoid-break space-y-3">
              <SectionHeading
                number="03"
                title="Graphical Telemetry Trend Profiles"
                right={`Bucket Resolution: ${report.bucketLabel}`}
              />

              <div className={cx("grid gap-3.5", isWideFormat ? "md:grid-cols-2" : "grid-cols-1")}>
                <VectorTrendChart
                  figure="Figure 3.1"
                  title="Thermal & Psychrometric Profile"
                  subtitle="Supply Air (°C), Room Air (°C) & Relative Humidity (%RH)"
                  rows={chartRows}
                  series={[
                    { key: "supplyTemp", label: "Supply Air (°C)", color: "#1d6ef2" },
                    { key: "roomTemp", label: "Room Air (°C)", color: "#d97706" },
                    { key: "humidity", label: "Humidity (%RH)", color: "#7c3aed" },
                  ]}
                />

                <VectorTrendChart
                  figure="Figure 3.2"
                  title="Filtration, Electrical & Duty Profile"
                  subtitle="Filter ΔP (Pa), Feeder Current (A) & RUN Duty (%)"
                  rows={chartRows}
                  series={[
                    { key: "filterDiffPressure", label: "Filter ΔP (Pa)", color: "#db2777" },
                    { key: "current", label: "Current (A)", color: "#0891b2" },
                    { key: "runPct", label: "RUN Duty (%)", color: "#059669" },
                  ]}
                />
              </div>
            </section>

            {/* SECTION 4: TIME-INTERVAL AGGREGATION BREAKDOWN */}
            {includeIntervals ? (
              <section className="space-y-2.5">
                <SectionHeading
                  number="04"
                  title="Time-Interval Aggregation Breakdown"
                  right={`${report.buckets.length} intervals · ${report.bucketLabel}`}
                />

                {report.buckets.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-[#cbd5e1] py-6 text-center text-xs text-[#64748b]">
                    No interval buckets recorded in the selected time range.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-[#cbd5e1]">
                    <table className="report-table w-full text-left text-[10.5px]">
                      <thead>
                        <tr className="border-b border-[#94a3b8] bg-[#eef3f9] text-[9.5px] font-bold uppercase tracking-wider text-[#0b1f3f]">
                          <th className="px-2.5 py-2">Interval Start</th>
                          <th className="px-2 py-2 text-right">Samples</th>
                          <th className="px-2 py-2 text-right">RUN %</th>
                          <th className="px-2 py-2 text-right">Supply °C</th>
                          <th className="px-2 py-2 text-right">Room °C</th>
                          {isWideFormat ? <th className="px-2 py-2 text-right">Return °C</th> : null}
                          {isWideFormat ? <th className="px-2 py-2 text-right">Coil °C</th> : null}
                          <th className="px-2 py-2 text-right">RH %</th>
                          <th className="px-2 py-2 text-right">Filter ΔP</th>
                          {isWideFormat ? <th className="px-2 py-2 text-right">Fan %</th> : null}
                          <th className="px-2 py-2 text-right">Current A</th>
                          {isWideFormat ? <th className="px-2 py-2 text-right">Voltage V</th> : null}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e2e8f0]">
                        {report.buckets.map((b, idx) => {
                          const intervalKeys: ParamKey[] = isWideFormat
                            ? [
                                "supplyTemp",
                                "roomTemp",
                                "returnTemp",
                                "coilTemp",
                                "humidity",
                                "filterDiffPressure",
                                "fanSpeed",
                                "current",
                                "voltage",
                              ]
                            : ["supplyTemp", "roomTemp", "humidity", "filterDiffPressure", "current"];
                          return (
                            <tr key={b.bucket} className={idx % 2 === 1 ? "bg-[#f8fafc]" : "bg-white"}>
                              <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-[#334155]">
                                {fmtBucketTs(b.bucket)}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums text-[#334155]">
                                {b.count}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono font-semibold tabular-nums text-[#047857]">
                                {b.count === 0 ? "—" : `${((b.runCount / b.count) * 100).toFixed(0)}%`}
                              </td>
                              {intervalKeys.map((p) => {
                                const decimals = PARAMETERS.find((x) => x.key === p)!.decimals;
                                const v = b.values[p];
                                return (
                                  <td
                                    key={p}
                                    className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums text-[#0f172a]"
                                  >
                                    {v === null || v === undefined ? "—" : Number(v).toFixed(decimals)}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : null}

            {/* SECTION 5: CHRONOLOGICAL LOGGED TELEMETRY SAMPLES */}
            {includeSamples ? (
              <section className="space-y-3">
                <SectionHeading
                  number="05"
                  title="Chronological Telemetry Sample Log"
                  right={`Showing ${displayedSamples.length} of ${report.totalRows.toLocaleString()} matching records`}
                />

                {displayedSamples.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-[#cbd5e1] py-6 text-center text-xs text-[#64748b]">
                    No individual telemetry samples in this reporting window.
                  </p>
                ) : isWideFormat ? (
                  /* Wide Landscape / A3 Unified Table (plenty of horizontal room — zero clipping) */
                  <div className="overflow-x-auto rounded-lg border border-[#cbd5e1]">
                    <table className="report-table w-full text-left text-[10px]">
                      <thead>
                        <tr className="border-b border-[#94a3b8] bg-[#eef3f9] text-[9px] font-bold uppercase tracking-wider text-[#0b1f3f]">
                          <th className="px-2 py-2">Timestamp</th>
                          <th className="px-1.5 py-2">Src</th>
                          <th className="px-1.5 py-2">State</th>
                          {PARAMETERS.map((p) => (
                            <th key={p.key} className="whitespace-nowrap px-1.5 py-2 text-right">
                              {PARAM_SHORT_HEADER[p.key]}
                            </th>
                          ))}
                          <th className="px-2 py-2">Clarity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e2e8f0]">
                        {displayedSamples.map((row, i) => {
                          const flags = sampleFlags(row);
                          return (
                            <tr key={String(row.id ?? i)} className={i % 2 === 1 ? "bg-[#f8fafc]" : "bg-white"}>
                              <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[#334155]">
                                {fmtCompactTs(row.timestamp)}
                              </td>
                              <td className="whitespace-nowrap px-1.5 py-1.5 font-mono text-[9px] font-bold text-[#1d6ef2]">
                                {row.source === "SIMULATION" ? "SIM" : "PHY"}
                              </td>
                              <td className="whitespace-nowrap px-1.5 py-1.5 font-mono font-semibold text-[#0f172a]">
                                {String(row.runState ?? "—")}
                              </td>
                              {PARAMETERS.map((p) => (
                                <td
                                  key={p.key}
                                  className="whitespace-nowrap px-1.5 py-1.5 text-right font-mono tabular-nums text-[#0f172a]"
                                >
                                  {row[p.key] === null || row[p.key] === undefined ? (
                                    <span className="text-[#94a3b8]">—</span>
                                  ) : (
                                    Number(row[p.key]).toFixed(p.decimals)
                                  )}
                                </td>
                              ))}
                              <td className="whitespace-nowrap px-2 py-1.5">
                                <QualityTag quality={flags[0] ?? "OK"} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* Portrait Split Sub-Tables (5A + 5B): Fits A4 / Letter / Legal Portrait with 0% Horizontal Cut-Off! */
                  <div className="space-y-3.5">
                    <div>
                      <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[#334155]">
                        Table 5A · Thermal, Psychrometric &amp; Airflow Parameters
                      </p>
                      <div className="overflow-x-auto rounded-lg border border-[#cbd5e1]">
                        <table className="report-table w-full text-left text-[10px]">
                          <thead>
                            <tr className="border-b border-[#94a3b8] bg-[#eef3f9] text-[9px] font-bold uppercase tracking-wider text-[#0b1f3f]">
                              <th className="px-2 py-1.5">Timestamp</th>
                              <th className="px-1.5 py-1.5">Src</th>
                              <th className="px-1.5 py-1.5">State</th>
                              {THERMAL_AIR_PARAMS.map((k) => (
                                <th key={k} className="whitespace-nowrap px-1.5 py-1.5 text-right">
                                  {PARAM_SHORT_HEADER[k]}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#e2e8f0]">
                            {displayedSamples.map((row, i) => (
                              <tr key={`a-${String(row.id ?? i)}`} className={i % 2 === 1 ? "bg-[#f8fafc]" : "bg-white"}>
                                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[#334155]">
                                  {fmtCompactTs(row.timestamp)}
                                </td>
                                <td className="whitespace-nowrap px-1.5 py-1.5 font-mono text-[9px] font-bold text-[#1d6ef2]">
                                  {row.source === "SIMULATION" ? "SIM" : "PHY"}
                                </td>
                                <td className="whitespace-nowrap px-1.5 py-1.5 font-mono font-semibold text-[#0f172a]">
                                  {String(row.runState ?? "—")}
                                </td>
                                {THERMAL_AIR_PARAMS.map((k) => {
                                  const meta = PARAMETERS.find((p) => p.key === k)!;
                                  return (
                                    <td
                                      key={k}
                                      className="whitespace-nowrap px-1.5 py-1.5 text-right font-mono tabular-nums text-[#0f172a]"
                                    >
                                      {row[k] === null || row[k] === undefined ? (
                                        <span className="text-[#94a3b8]">—</span>
                                      ) : (
                                        Number(row[k]).toFixed(meta.decimals)
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[#334155]">
                        Table 5B · Filtration, Actuators, Electrical &amp; NFR-06 Data Integrity
                      </p>
                      <div className="overflow-x-auto rounded-lg border border-[#cbd5e1]">
                        <table className="report-table w-full text-left text-[10px]">
                          <thead>
                            <tr className="border-b border-[#94a3b8] bg-[#eef3f9] text-[9px] font-bold uppercase tracking-wider text-[#0b1f3f]">
                              <th className="px-2 py-1.5">Timestamp</th>
                              {MECH_ELEC_PARAMS.map((k) => (
                                <th key={k} className="whitespace-nowrap px-1.5 py-1.5 text-right">
                                  {PARAM_SHORT_HEADER[k]}
                                </th>
                              ))}
                              <th className="px-2 py-1.5">Source</th>
                              <th className="px-2 py-1.5">NFR-06 Clarity</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#e2e8f0]">
                            {displayedSamples.map((row, i) => {
                              const flags = sampleFlags(row);
                              return (
                                <tr key={`b-${String(row.id ?? i)}`} className={i % 2 === 1 ? "bg-[#f8fafc]" : "bg-white"}>
                                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[#334155]">
                                    {fmtCompactTs(row.timestamp)}
                                  </td>
                                  {MECH_ELEC_PARAMS.map((k) => {
                                    const meta = PARAMETERS.find((p) => p.key === k)!;
                                    return (
                                      <td
                                        key={k}
                                        className="whitespace-nowrap px-1.5 py-1.5 text-right font-mono tabular-nums text-[#0f172a]"
                                      >
                                        {row[k] === null || row[k] === undefined ? (
                                          <span className="text-[#94a3b8]">—</span>
                                        ) : (
                                          Number(row[k]).toFixed(meta.decimals)
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td className="whitespace-nowrap px-2 py-1.5">
                                    <SourceTag source={(row.source as string) ?? null} />
                                  </td>
                                  <td className="whitespace-nowrap px-2 py-1.5">
                                    <QualityTag quality={flags[0] ?? "OK"} />
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
              </section>
            ) : null}

            {/* SECTION 6: FORMAL ENGINEERING VERIFICATION & SIGN-OFF */}
            <section className="avoid-break space-y-3 pt-2">
              <SectionHeading
                number="06"
                title="Verification, Compliance & Engineering Sign-Off"
                right="Controlled Document Attestation"
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <SignatureBox
                  roleTitle="Prepared By"
                  name={preparedByName}
                  subRole={sessionUser ? `${sessionUser.role} · Digital Session Verified` : "System Telemetry Export"}
                  dateText={fmtDateTime(generatedAt ?? new Date())}
                  verified
                />
                <SignatureBox
                  roleTitle="Reviewed By"
                  name="Facility HVAC / BMS Engineer"
                  subRole="Instrumentation & Threshold Review"
                  dateText="Date: ____ / ____ / ________"
                />
                <SignatureBox
                  roleTitle="Approved By"
                  name="Plant / Operations Manager"
                  subRole="Operational Compliance Sign-Off"
                  dateText="Date: ____ / ____ / ________"
                />
              </div>

              <footer className="mt-4 flex flex-col justify-between gap-2 border-t-2 border-[#0b1f3f] pt-3 text-[10px] text-[#475569] sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <FileCheck2 size={13} className="flex-none text-[#0b1f3f]" />
                  <span>
                    <strong className="font-bold text-[#0b1f3f]">{docRef}</strong> · Smart Monitoring AHU · NFR-06
                    disambiguated telemetry · Full raw dataset exportable via CSV (FR-12).
                  </span>
                </div>
                <span className="font-mono text-[9.5px] font-semibold text-[#334155]">
                  Format: {paperSize} {orientation.toUpperCase()} · End of Controlled Report
                </span>
              </footer>
            </section>
          </div>
        </article>
  );
}
