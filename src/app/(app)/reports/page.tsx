"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileSpreadsheet,
  Maximize2,
  Minimize2,
  Printer,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { api, usePoll } from "@/lib/client";
import { useSessionUser } from "@/components/AppShell";
import { AHU_IDS, MAX_REPORT_RANGE_DAYS } from "@/lib/domain";
import { Btn, Empty, ErrorNote, Field, Spinner, cx, inputClass } from "@/components/ui";
import ReportSheet from "./report-sheet";
import { type Orientation, type PaperSize, type Report } from "./report-sheet-parts";

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

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function ReportsPage() {
  const sessionUser = useSessionUser();
  const [ahuId, setAhuId] = useState<string>(AHU_IDS[0]);
  // Unit list follows the ACTIVE device fleet (Daikin DB ⇄ My DB switch).
  const { data: fleetList } = usePoll<{ ahus: Array<{ id: string }> }>("/api/ahu", 60000);
  const unitIds = fleetList?.ahus?.length ? fleetList.ahus.map((a) => a.id) : [...AHU_IDS];
  const activeAhuId = unitIds.includes(ahuId) ? ahuId : unitIds[0];
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
    return `ahuId=${activeAhuId}&from=${encodeURIComponent(fIso)}&to=${encodeURIComponent(tIso)}&source=${source}`;
  }, [activeAhuId, from, to, source]);

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

  // Automatically load initial report on first visit (and when the active
  // fleet resolves the default unit after the /api/ahu list arrives).
  const initialUnitRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialUnitRef.current === activeAhuId) return;
    initialUnitRef.current = activeAhuId;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAhuId]);

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
    return `SMA-RPT-${stamp}-${report?.ahuId ?? activeAhuId}`;
  }, [generatedAt, report?.ahuId, activeAhuId]);

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
          <Field label="Device">
            <select value={activeAhuId} onChange={(e) => setAhuId(e.target.value)} className={inputClass}>
              {unitIds.map((id) => (
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
        <Empty>Select a device and time window, then click Generate Report.</Empty>
      ) : null}

      {report ? (
        <ReportSheet
          report={report}
          docRef={docRef}
          preparedByName={preparedByName}
          sessionUser={sessionUser}
          generatedAt={generatedAt}
          paperSize={paperSize}
          orientation={orientation}
          isWideFormat={isWideFormat}
          sheetMaxWidth={sheetMaxWidth}
          rangeDays={rangeDays}
          chartRows={chartRows}
          displayedSamples={displayedSamples}
          fallbackTotal={fallbackTotal}
          executiveSummary={executiveSummary}
          includeIntervals={includeIntervals}
          includeSamples={includeSamples}
        />
      ) : null}

    </div>
  );
}
