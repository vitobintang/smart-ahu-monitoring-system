"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  CheckCircle2,
  FileCheck2,
  FileSpreadsheet,
  Maximize2,
  Minimize2,
  Printer,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { api, fmtDateTime } from "@/lib/client";
import { useSessionUser } from "@/components/AppShell";
import { AHU_IDS, MAX_REPORT_RANGE_DAYS, PARAMETERS, type DataQuality, type ParamKey } from "@/lib/domain";
import { Btn, Empty, ErrorNote, Field, QualityTag, SourceTag, Spinner, cx, inputClass } from "@/components/ui";

interface ReportStats {
  parameter: ParamKey;
  label: string;
  unit: string;
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  fallbackCount: number;
  installed: boolean;
}

interface Report {
  ahuId: string;
  ahuName: string;
  ahuLocation?: string;
  controlMode?: string;
  setpoint?: number;
  commTimeoutSec?: number;
  installedSensorCount?: number;
  from: string;
  to: string;
  source: string;
  totalRows: number;
  physicalRows: number;
  simulationRows: number;
  runSamples: number;
  runProportion: number;
  stats: ReportStats[];
  buckets: { bucket: number; count: number; runCount: number; values: Record<string, number | null> }[];
  bucketLabel: string;
  samples: Array<Record<string, unknown> & { timestamp: string }>;
  sampleLimit: number;
}

type PaperSize = "A4" | "Letter" | "Legal" | "A3" | "Auto";
type Orientation = "portrait" | "landscape";

const PAPER_META: Record<
  PaperSize,
  {
    label: string;
    dimensions: string;
    cssSize: string;
    portraitPx: number;
    landscapePx: number;
  }
> = {
  A4: {
    label: "A4 Standard",
    dimensions: "210 × 297 mm",
    cssSize: "A4",
    portraitPx: 820,
    landscapePx: 1140,
  },
  Letter: {
    label: "US Letter",
    dimensions: "8.5 × 11 in",
    cssSize: "letter",
    portraitPx: 840,
    landscapePx: 1090,
  },
  Legal: {
    label: "US Legal",
    dimensions: "8.5 × 14 in",
    cssSize: "legal",
    portraitPx: 840,
    landscapePx: 1340,
  },
  A3: {
    label: "A3 Wide",
    dimensions: "297 × 420 mm",
    cssSize: "A3",
    portraitPx: 1140,
    landscapePx: 1540,
  },
  Auto: {
    label: "Fluid / Fit Page",
    dimensions: "Adaptive width",
    cssSize: "auto",
    portraitPx: 1400,
    landscapePx: 1600,
  },
};

const THERMAL_AIR_PARAMS: ParamKey[] = [
  "supplyTemp",
  "returnTemp",
  "roomTemp",
  "coilTemp",
  "humidity",
  "fanSpeed",
];

const MECH_ELEC_PARAMS: ParamKey[] = [
  "filterDiffPressure",
  "damperPosition",
  "heaterOutput",
  "current",
  "voltage",
  "runHours",
];

const PARAM_SHORT_HEADER: Record<ParamKey, string> = {
  supplyTemp: "Sup °C",
  returnTemp: "Ret °C",
  roomTemp: "Room °C",
  coilTemp: "Coil °C",
  humidity: "RH %",
  filterDiffPressure: "ΔP Pa",
  fanSpeed: "Fan %",
  damperPosition: "Dmp %",
  heaterOutput: "Htr %",
  current: "Curr A",
  voltage: "Volt V",
  runHours: "Run h",
};

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function fmtCompactTs(ts: string | number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtBucketTs(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReportsPage() {
  const sessionUser = useSessionUser();
  const [ahuId, setAhuId] = useState<string>(AHU_IDS[0]);
  const [from, setFrom] = useState(() => toLocalInput(new Date(Date.now() - 6 * 3600 * 1000)));
  const [to, setTo] = useState(() => toLocalInput(new Date()));
  const [source, setSource] = useState<"ALL" | "PHYSICAL" | "SIMULATION">("ALL");

  // Formal document page configuration (defaults to A4 + Portrait per standard engineering workflow)
  const [paperSize, setPaperSize] = useState<PaperSize>("A4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [sheetPreview, setSheetPreview] = useState<boolean>(true);
  const [samplePrintCap, setSamplePrintCap] = useState<number>(50);
  const [includeIntervals, setIncludeIntervals] = useState<boolean>(true);
  const [includeSamples, setIncludeSamples] = useState<boolean>(true);

  const [report, setReport] = useState<Report | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const rangeDays = useMemo(() => {
    const f = new Date(from).getTime();
    const t = new Date(to).getTime();
    return Number.isFinite(f) && Number.isFinite(t) ? (t - f) / 86_400_000 : 0;
  }, [from, to]);
  const rangeInvalid = rangeDays <= 0 || rangeDays > MAX_REPORT_RANGE_DAYS;

  const query = useMemo(() => {
    const fIso = Number.isNaN(new Date(from).getTime()) ? new Date().toISOString() : new Date(from).toISOString();
    const tIso = Number.isNaN(new Date(to).getTime()) ? new Date().toISOString() : new Date(to).toISOString();
    return `ahuId=${ahuId}&from=${encodeURIComponent(fIso)}&to=${encodeURIComponent(tIso)}&source=${source}`;
  }, [ahuId, from, to, source]);

  async function generate() {
    if (rangeInvalid) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<Report>(`/api/reports?${query}`);
      setReport(data);
      setGeneratedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report generation failed");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  // Automatically load initial report on first visit
  useEffect(() => {
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPresetHours(hours: number) {
    const now = new Date();
    setTo(toLocalInput(now));
    setFrom(toLocalInput(new Date(now.getTime() - hours * 3_600_000)));
  }

  const isWideFormat = orientation === "landscape" || paperSize === "A3" || paperSize === "Auto";
  const paper = PAPER_META[paperSize];
  const sheetMaxWidth =
    !sheetPreview || paperSize === "Auto"
      ? undefined
      : orientation === "landscape"
        ? paper.landscapePx
        : paper.portraitPx;

  const printPageCss = useMemo(() => {
    const sizeValue =
      paperSize === "Auto" ? orientation : `${paper.cssSize} ${orientation}`;
    const marginValue =
      orientation === "landscape" ? "9mm 10mm 11mm 10mm" : "10mm 10mm 12mm 10mm";
    return `@media print { @page { size: ${sizeValue}; margin: ${marginValue}; } }`;
  }, [paper.cssSize, paperSize, orientation]);

  const chartRows = useMemo(
    () =>
      (report?.buckets ?? []).map((b) => ({
        t: b.bucket,
        supplyTemp: b.values.supplyTemp ?? null,
        roomTemp: b.values.roomTemp ?? null,
        humidity: b.values.humidity ?? null,
        current: b.values.current ?? null,
        filterDiffPressure: b.values.filterDiffPressure ?? null,
        runPct: b.count === 0 ? 0 : Number(((b.runCount / b.count) * 100).toFixed(1)),
      })),
    [report],
  );

  const displayedSamples = useMemo(() => {
    if (!report) return [];
    return samplePrintCap > 0 ? report.samples.slice(0, samplePrintCap) : report.samples;
  }, [report, samplePrintCap]);

  const docRef = useMemo(() => {
    const stamp = (generatedAt ?? new Date()).toISOString().slice(0, 10).replaceAll("-", "");
    return `SMA-RPT-${stamp}-${report?.ahuId ?? ahuId}`;
  }, [generatedAt, report?.ahuId, ahuId]);

  const preparedByName =
    sessionUser?.fullName?.trim() ||
    (sessionUser?.username ? `@${sessionUser.username}` : null) ||
    sessionUser?.email ||
    "Authorized Operator";

  const fallbackTotal = useMemo(() => {
    if (!report) return 0;
    return (
      (report.stats.find((s) => s.parameter === "current")?.fallbackCount ?? 0) +
      (report.stats.find((s) => s.parameter === "voltage")?.fallbackCount ?? 0)
    );
  }, [report]);

  const executiveSummary = useMemo(() => {
    if (!report) return "";
    const sup = report.stats.find((s) => s.parameter === "supplyTemp");
    const room = report.stats.find((s) => s.parameter === "roomTemp");
    const dp = report.stats.find((s) => s.parameter === "filterDiffPressure");
    const rh = report.stats.find((s) => s.parameter === "humidity");

    if (report.totalRows === 0) {
      return `No telemetry records were captured for ${report.ahuId} (${report.ahuName}) within the selected reporting window under source filter "${report.source}". Verify unit connectivity or widen the query period.`;
    }

    const parts: string[] = [
      `During the selected ${(rangeDays * 24).toFixed(1)}-hour window, ${report.ahuId} (${report.ahuName}) recorded ${report.totalRows.toLocaleString()} valid telemetry samples (${report.physicalRows.toLocaleString()} physical, ${report.simulationRows.toLocaleString()} simulated) with an operational RUN duty factor of ${(report.runProportion * 100).toFixed(1)}%.`,
    ];
    if (sup?.avg !== null && sup?.avg !== undefined) {
      parts.push(
        `Supply air temperature averaged ${sup.avg.toFixed(1)} °C (range ${sup.min?.toFixed(1)}–${sup.max?.toFixed(1)} °C) against a configured setpoint of ${(report.setpoint ?? 22).toFixed(1)} °C${
          room?.avg !== null && room?.avg !== undefined ? `, while conditioned room temperature averaged ${room.avg.toFixed(1)} °C` : ""
        }${rh?.avg !== null && rh?.avg !== undefined ? ` at ${rh.avg.toFixed(0)} %RH mean relative humidity.` : "."}`,
      );
    }
    if (dp?.max !== null && dp?.max !== undefined) {
      parts.push(
        `Filtration differential pressure peaked at ${dp.max.toFixed(0)} Pa (mean ${dp.avg?.toFixed(0) ?? "—"} Pa).`,
      );
    }
    parts.push(
      fallbackTotal > 0
        ? `${fallbackTotal} electrical sentinel readings were isolated and excluded from statistical means in accordance with NFR-06.`
        : `Zero electrical fallback sentinels occurred; all reported averages reflect verified telemetry readings (NFR-06).`,
    );
    return parts.join(" ");
  }, [report, rangeDays, fallbackTotal]);

  return (
    <div className="space-y-5">
      {/* Dynamic @page CSS injection so browser Print / Save-as-PDF honors chosen paper & orientation */}
      <style dangerouslySetInnerHTML={{ __html: printPageCss }} />

      {/* Screen-only page title */}
      <div className="no-print flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[20px] font-bold tracking-[-0.02em] text-[#12294d] sm:text-[23px]">
            Formal Engineering Reports &amp; Data Logger
          </h1>
          <p className="text-xs text-[#475569]">
            FR-10 / FR-11 / FR-12 controlled operational dossier · default <strong>A4 Portrait</strong> with flexible
            paper &amp; orientation formatting
          </p>
        </div>
        {report ? (
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/reports?${query}&format=csv`} download>
              <Btn variant="success" size="md">
                <FileSpreadsheet size={14} /> Export CSV
              </Btn>
            </a>
            <Btn variant="primary" size="md" onClick={() => window.print()}>
              <Printer size={14} /> Print / Save Formal PDF ({paperSize} · {orientation === "portrait" ? "Portrait" : "Landscape"})
            </Btn>
          </div>
        ) : null}
      </div>

      {/* Screen-only Query + Page Layout Control Panel */}
      <div className="panel no-print space-y-4 rounded-2xl p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="AHU Unit">
            <select value={ahuId} onChange={(e) => setAhuId(e.target.value)} className={inputClass}>
              {AHU_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Period From">
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Period To">
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Telemetry Source">
            <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className={inputClass}>
              <option value="ALL">ALL SOURCES</option>
              <option value="PHYSICAL">PHYSICAL ONLY</option>
              <option value="SIMULATION">SIMULATION ONLY</option>
            </select>
          </Field>
          <div className="flex items-end">
            <Btn
              variant="primary"
              onClick={() => void generate()}
              disabled={loading || rangeInvalid}
              className="w-full py-2.5"
            >
              <RefreshCw size={13} className={cx(loading && "animate-spin")} />
              {loading ? "Compiling…" : "Generate Report"}
            </Btn>
          </div>
        </div>

        {/* Quick range presets + range validation */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e6ecf5] pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10.5px] font-bold uppercase tracking-wider text-[#475569]">Quick range:</span>
            {[
              { label: "Last 1 h", h: 1 },
              { label: "Last 6 h", h: 6 },
              { label: "Last 24 h", h: 24 },
              { label: "Last 7 d", h: 24 * 7 },
              { label: "Last 30 d", h: 24 * 30 },
            ].map((p) => (
              <Btn key={p.label} size="sm" variant="subtle" onClick={() => applyPresetHours(p.h)}>
                {p.label}
              </Btn>
            ))}
          </div>
          <p className={cx("text-[11px] font-medium", rangeInvalid ? "text-red-600" : "text-[#475569]")}>
            Window: <span className="font-mono font-bold text-[#12294d]">{rangeDays.toFixed(2)} days</span>
            {rangeDays > MAX_REPORT_RANGE_DAYS
              ? ` — exceeds ${MAX_REPORT_RANGE_DAYS}-day maximum (FR-10)`
              : rangeDays <= 0
                ? " — end time must be after start time"
                : ` · max ${MAX_REPORT_RANGE_DAYS} days`}
          </p>
        </div>

        {/* Flexible Paper Size, Orientation & Section Controls */}
        <div className="rounded-xl border border-[#e2eaf4] bg-[#f8fafd] p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="eyebrow mb-1.5 flex items-center gap-1">
                <SlidersHorizontal size={11} /> Paper Size
              </p>
              <select
                aria-label="Paper size"
                value={paperSize}
                onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                className={cx(inputClass, "py-1.5 text-xs font-semibold")}
              >
                {(Object.keys(PAPER_META) as PaperSize[]).map((k) => (
                  <option key={k} value={k}>
                    {PAPER_META[k].label} ({PAPER_META[k].dimensions})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="eyebrow mb-1.5">Page Orientation</p>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#cbd5e1] bg-white p-0.5">
                {(["portrait", "landscape"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOrientation(o)}
                    className={cx(
                      "rounded-md py-1.5 text-[11px] font-bold capitalize transition",
                      orientation === o
                        ? "bg-[#12294d] text-white shadow-xs"
                        : "text-[#475569] hover:text-[#0f172a]",
                    )}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="eyebrow mb-1.5">Logged Sample Rows</p>
              <select
                aria-label="Logged sample rows"
                value={samplePrintCap}
                onChange={(e) => setSamplePrintCap(Number(e.target.value))}
                className={cx(inputClass, "py-1.5 text-xs font-semibold")}
              >
                <option value={25}>Latest 25 rows (compact)</option>
                <option value={50}>Latest 50 rows (standard)</option>
                <option value={100}>Latest 100 rows (detailed)</option>
                <option value={0}>All loaded rows (up to 300)</option>
              </select>
            </div>

            <div>
              <p className="eyebrow mb-1.5">Sections &amp; Preview</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIncludeIntervals((v) => !v)}
                  className={cx(
                    "rounded-md border px-2 py-1 text-[10.5px] font-semibold transition",
                    includeIntervals
                      ? "border-[#2563eb]/40 bg-[#eff6ff] text-[#1d4ed8]"
                      : "border-[#cbd5e1] bg-white text-[#64748b]",
                  )}
                >
                  Intervals {includeIntervals ? "✓" : "Off"}
                </button>
                <button
                  type="button"
                  onClick={() => setIncludeSamples((v) => !v)}
                  className={cx(
                    "rounded-md border px-2 py-1 text-[10.5px] font-semibold transition",
                    includeSamples
                      ? "border-[#2563eb]/40 bg-[#eff6ff] text-[#1d4ed8]"
                      : "border-[#cbd5e1] bg-white text-[#64748b]",
                  )}
                >
                  Samples {includeSamples ? "✓" : "Off"}
                </button>
                <button
                  type="button"
                  onClick={() => setSheetPreview((v) => !v)}
                  className="ml-auto hidden items-center gap-1 rounded-md border border-[#cbd5e1] bg-white px-2 py-1 text-[10.5px] font-semibold text-[#334155] hover:border-[#94a3b8] md:inline-flex"
                  title="Toggle proportional paper sheet preview vs full screen width"
                >
                  {sheetPreview ? <Maximize2 size={11} /> : <Minimize2 size={11} />}
                  {sheetPreview ? "Full width" : "Paper view"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ErrorNote message={error} />
      {loading && !report ? <Spinner label="Compiling formal engineering report…" /> : null}

      {!report && !loading && !error ? (
        <Empty>Select an AHU unit and time window, then click Generate Report.</Empty>
      ) : null}

      {/* ================================================================== */}
      {/* FORMAL ENGINEERING REPORT SHEET (Screen Preview + Print/PDF Ready) */}
      {/* ================================================================== */}
      {report ? (
        <article
          style={sheetMaxWidth ? { maxWidth: `${sheetMaxWidth}px` } : undefined}
          className="report-sheet mx-auto w-full overflow-hidden rounded-2xl border border-[#cfd9e6] bg-white text-[#0f172a] shadow-[0_20px_60px_-24px_rgba(15,23,42,0.28)]"
        >
          {/* Top formal authority bar */}
          <div className="h-2 w-full bg-gradient-to-r from-[#0b1f3f] via-[#163a70] to-[#1d6ef2]" />

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
      ) : null}
    </div>
  );
}

function sampleFlags(row: Record<string, unknown>): DataQuality[] {
  const flags: DataQuality[] = [];
  if (row.isCurrentFallback || row.isVoltageFallback) flags.push("ESTIMATED_FALLBACK");
  if (row.source === "SIMULATION") flags.push("SIMULATED");
  const missing = PARAMETERS.filter((p) => row[p.key] === null || row[p.key] === undefined).length;
  if (missing > 0) flags.push("NULL_UNAVAILABLE");
  return flags;
}

function SectionHeading({ number, title, right }: { number: string; title: string; right?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#cbd5e1] pb-1.5">
      <div className="flex items-center gap-2">
        <span className="rounded bg-[#0b1f3f] px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
          SEC {number}
        </span>
        <h3 className="text-[12.5px] font-extrabold uppercase tracking-[0.04em] text-[#0b1f3f]">{title}</h3>
      </div>
      {right ? <span className="font-mono text-[10px] font-medium text-[#475569]">{right}</span> : null}
    </div>
  );
}

function SpecCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white px-3 py-2">
      <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#64748b]">{label}</p>
      <p className={cx("mt-0.5 truncate text-[11px] font-semibold text-[#0f172a]", mono && "font-mono")}>{value}</p>
    </div>
  );
}

function FormalKpi({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "navy" | "emerald" | "blue" | "violet" | "amber" | "slate";
  className?: string;
}) {
  const accents = {
    navy: "border-t-[#0b1f3f] text-[#0b1f3f]",
    emerald: "border-t-[#059669] text-[#047857]",
    blue: "border-t-[#1d6ef2] text-[#1d4ed8]",
    violet: "border-t-[#7c3aed] text-[#6d28d9]",
    amber: "border-t-[#d97706] text-[#b45309]",
    slate: "border-t-[#64748b] text-[#334155]",
  } as const;
  return (
    <div
      className={cx(
        "rounded-lg border border-[#cbd5e1] border-t-[3px] bg-[#fbfdff] px-3 py-2.5",
        accents[tone],
        className,
      )}
    >
      <p className="text-[9.5px] font-bold uppercase tracking-wider text-[#475569]">{label}</p>
      <p className="mt-1 font-mono text-[20px] font-extrabold leading-none tabular-nums">{value}</p>
      <p className="mt-1 truncate text-[10px] text-[#64748b]">{sub}</p>
    </div>
  );
}

function SignatureBox({
  roleTitle,
  name,
  subRole,
  dateText,
  verified,
}: {
  roleTitle: string;
  name: string;
  subRole: string;
  dateText: string;
  verified?: boolean;
}) {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-[#cbd5e1] bg-[#fbfdff] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#475569]">{roleTitle}</span>
        {verified ? (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-300">
            <CheckCircle2 size={10} /> SIGNED
          </span>
        ) : (
          <span className="font-mono text-[9px] uppercase text-[#94a3b8]">Sign / Stamp</span>
        )}
      </div>

      <div className="my-4 h-7 border-b border-dashed border-[#94a3b8]">
        {verified ? (
          <p className="pt-1 font-serif text-[13px] italic text-[#12294d]">{name}</p>
        ) : null}
      </div>

      <div>
        <p className="truncate text-[11px] font-bold text-[#0f172a]">{name}</p>
        <p className="truncate text-[10px] text-[#475569]">{subRole}</p>
        <p className="mt-1 font-mono text-[9.5px] text-[#64748b]">{dateText}</p>
      </div>
    </div>
  );
}

/**
 * Pure Vector Print-Safe Multi-Series Line Chart.
 * Scales cleanly via SVG viewBox across A4/Letter/Legal/A3 Portrait & Landscape
 * with zero Recharts JS width clipping during window.print().
 */
function VectorTrendChart({
  figure,
  title,
  subtitle,
  rows,
  series,
}: {
  figure: string;
  title: string;
  subtitle: string;
  rows: Array<Record<string, number | null>>;
  series: Array<{ key: string; label: string; color: string }>;
}) {
  const W = 680;
  const H = 196;
  const padL = 44;
  const padR = 16;
  const padT = 14;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allValues: number[] = [];
  for (const r of rows) {
    for (const s of series) {
      const v = r[s.key];
      if (typeof v === "number" && Number.isFinite(v)) allValues.push(v);
    }
  }

  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 100;
  const padRange = rawMax === rawMin ? Math.max(1, Math.abs(rawMax) * 0.1) : (rawMax - rawMin) * 0.1;
  const yMin = rawMin - padRange;
  const yMax = rawMax + padRange;

  const tMin = rows.length > 0 ? Number(rows[0].t ?? 0) : 0;
  const tMax = rows.length > 1 ? Number(rows[rows.length - 1].t ?? tMin + 1) : tMin + 1;

  const xOf = (t: number, idx: number) => {
    if (rows.length <= 1 || tMax <= tMin) return padL + plotW / 2;
    const ratio = (t - tMin) / (tMax - tMin);
    return padL + (Number.isFinite(ratio) ? ratio : idx / Math.max(1, rows.length - 1)) * plotW;
  };
  const yOf = (v: number) => padT + plotH - ((v - yMin) / Math.max(1e-6, yMax - yMin)) * plotH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padT + plotH * (1 - f),
    val: yMin + (yMax - yMin) * f,
  }));

  const xTickIndices =
    rows.length <= 1
      ? rows.map((_, i) => i)
      : Array.from(new Set([0, Math.floor((rows.length - 1) * 0.33), Math.floor((rows.length - 1) * 0.66), rows.length - 1]));

  return (
    <div className="avoid-break rounded-lg border border-[#cbd5e1] bg-white p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-wider text-[#1d6ef2]">{figure}</span>
          <h4 className="text-[12px] font-bold text-[#0b1f3f]">{title}</h4>
          <p className="text-[10px] text-[#64748b]">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#334155]">
              <span className="h-2 w-2.5 rounded-xs" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {allValues.length === 0 ? (
        <div className="grid h-36 place-items-center rounded border border-dashed border-[#e2e8f0] text-[11px] text-[#64748b]">
          Insufficient interval data in selected window
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none overflow-visible">
          {/* Plot background */}
          <rect x={padL} y={padT} width={plotW} height={plotH} fill="#fbfdff" stroke="#e2e8f0" strokeWidth={1} />

          {/* Horizontal gridlines & Y ticks */}
          {yTicks.map((tk, i) => (
            <g key={i}>
              <line
                x1={padL}
                x2={padL + plotW}
                y1={tk.y}
                y2={tk.y}
                stroke="#e2e8f0"
                strokeDasharray={i === 0 || i === yTicks.length - 1 ? undefined : "3 3"}
                strokeWidth={0.9}
              />
              <text
                x={padL - 6}
                y={tk.y + 3}
                textAnchor="end"
                fontSize={9}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fill="#475569"
              >
                {tk.val.toFixed(Math.abs(tk.val) >= 100 ? 0 : 1)}
              </text>
            </g>
          ))}

          {/* X-axis time ticks */}
          {xTickIndices.map((idx) => {
            const row = rows[idx];
            if (!row || typeof row.t !== "number") return null;
            const x = xOf(row.t, idx);
            return (
              <g key={idx}>
                <line x1={x} x2={x} y1={padT + plotH} y2={padT + plotH + 4} stroke="#94a3b8" strokeWidth={1} />
                <text
                  x={x}
                  y={H - 6}
                  textAnchor={idx === 0 ? "start" : idx === rows.length - 1 ? "end" : "middle"}
                  fontSize={9}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fill="#475569"
                >
                  {fmtBucketTs(row.t)}
                </text>
              </g>
            );
          })}

          {/* Series polylines */}
          {series.map((s) => {
            const segments: string[] = [];
            let open = false;
            rows.forEach((r, idx) => {
              const v = r[s.key];
              const t = r.t;
              if (typeof v === "number" && Number.isFinite(v) && typeof t === "number") {
                const cmd = open ? "L" : "M";
                segments.push(`${cmd}${xOf(t, idx).toFixed(1)},${yOf(v).toFixed(1)}`);
                open = true;
              } else {
                open = false;
              }
            });
            if (segments.length === 0) return null;
            return (
              <g key={s.key}>
                <path
                  d={segments.join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {rows.length === 1 && typeof rows[0][s.key] === "number" && typeof rows[0].t === "number" ? (
                  <circle cx={xOf(rows[0].t, 0)} cy={yOf(rows[0][s.key] as number)} r={3.5} fill={s.color} />
                ) : null}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
