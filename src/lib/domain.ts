import type { AhuStatus, DataSource } from "@/lib/ahu";

/* ------------------------------------------------------------------ */
/* FR-06: the twelve supported AHU parameters                         */
/* ------------------------------------------------------------------ */

export type ParamKey =
  | "roomTemp"
  | "supplyTemp"
  | "returnTemp"
  | "humidity"
  | "filterDiffPressure"
  | "fanSpeed"
  | "coilTemp"
  | "damperPosition"
  | "current"
  | "voltage"
  | "runHours"
  | "heaterOutput";

export interface ParamMeta {
  key: ParamKey;
  label: string;
  localLabel: string;
  unit: string;
  validMin: number;
  validMax: number;
  decimals: number;
  defaultLow: number | null;
  defaultHigh: number | null;
  defaultPriority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  trendByDefault: boolean;
}

export const PARAMETERS: ParamMeta[] = [
  { key: "roomTemp", label: "Room Temperature", localLabel: "Suhu Ruangan", unit: "°C", validMin: -20, validMax: 60, decimals: 1, defaultLow: 16, defaultHigh: 28, defaultPriority: "MEDIUM", trendByDefault: true },
  { key: "supplyTemp", label: "Supply Air Temperature", localLabel: "Suhu Supply", unit: "°C", validMin: -20, validMax: 60, decimals: 1, defaultLow: 10, defaultHigh: 22, defaultPriority: "HIGH", trendByDefault: true },
  { key: "returnTemp", label: "Return Air Temperature", localLabel: "Suhu Return", unit: "°C", validMin: -20, validMax: 60, decimals: 1, defaultLow: 15, defaultHigh: 30, defaultPriority: "MEDIUM", trendByDefault: true },
  { key: "humidity", label: "Relative Humidity", localLabel: "Kelembapan", unit: "%RH", validMin: 0, validMax: 100, decimals: 1, defaultLow: 30, defaultHigh: 70, defaultPriority: "MEDIUM", trendByDefault: true },
  { key: "filterDiffPressure", label: "Filter Differential Pressure", localLabel: "Tekanan Diferensial Filter", unit: "Pa", validMin: 0, validMax: 2000, decimals: 0, defaultLow: 20, defaultHigh: 250, defaultPriority: "HIGH", trendByDefault: true },
  { key: "fanSpeed", label: "Fan Status / Speed", localLabel: "Fan", unit: "%", validMin: 0, validMax: 100, decimals: 0, defaultLow: null, defaultHigh: null, defaultPriority: "MEDIUM", trendByDefault: false },
  { key: "coilTemp", label: "Cooling Coil Status / Temp", localLabel: "Coil", unit: "°C", validMin: -20, validMax: 60, decimals: 1, defaultLow: 4, defaultHigh: 18, defaultPriority: "MEDIUM", trendByDefault: true },
  { key: "damperPosition", label: "Damper Position", localLabel: "Damper", unit: "%", validMin: 0, validMax: 100, decimals: 0, defaultLow: null, defaultHigh: null, defaultPriority: "LOW", trendByDefault: false },
  { key: "current", label: "Current", localLabel: "Arus", unit: "A", validMin: 0, validMax: 400, decimals: 2, defaultLow: null, defaultHigh: 25, defaultPriority: "HIGH", trendByDefault: true },
  { key: "voltage", label: "Voltage", localLabel: "Tegangan", unit: "V", validMin: 0, validMax: 500, decimals: 1, defaultLow: 198, defaultHigh: 242, defaultPriority: "MEDIUM", trendByDefault: false },
  { key: "runHours", label: "Operating Hours", localLabel: "Jam Operasi", unit: "h", validMin: 0, validMax: 200000, decimals: 1, defaultLow: null, defaultHigh: null, defaultPriority: "LOW", trendByDefault: false },
  { key: "heaterOutput", label: "Heater Output", localLabel: "Output Heater", unit: "%", validMin: 0, validMax: 100, decimals: 0, defaultLow: null, defaultHigh: null, defaultPriority: "LOW", trendByDefault: false },
];

export const PARAM_MAP: Record<ParamKey, ParamMeta> = PARAMETERS.reduce(
  (acc, p) => ({ ...acc, [p.key]: p }),
  {} as Record<ParamKey, ParamMeta>,
);

export const PARAM_KEYS = PARAMETERS.map((p) => p.key);

export const AHU_IDS = ["GTM-DAIKIN-001"] as const;

export const SETPOINT_MIN = 16.0;
export const SETPOINT_MAX = 30.0;
export const COMMAND_TTL_SEC = 60;
export const MAX_REPORT_RANGE_DAYS = 31;
export const LOCAL_POLL_INTERVAL_MS = 5000;
export const LOGIN_RATE_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

/* ------------------------------------------------------------------ */
/* NFR-06: data clarity & disambiguation                              */
/* ------------------------------------------------------------------ */

export type DataQuality =
  | "OK"
  | "UNINSTALLED"
  | "NULL_UNAVAILABLE"
  | "STALE"
  | "SIMULATED"
  | "ESTIMATED_FALLBACK";

export const QUALITY_LABEL: Record<DataQuality, string> = {
  OK: "OK",
  UNINSTALLED: "UNINSTALLED",
  NULL_UNAVAILABLE: "NULL / UNAVAILABLE",
  STALE: "STALE",
  SIMULATED: "SIMULATED",
  ESTIMATED_FALLBACK: "ESTIMATED_FALLBACK",
};

export const QUALITY_STYLE: Record<DataQuality, string> = {
  OK: "bg-emerald-50 text-emerald-700 ring-emerald-300",
  UNINSTALLED: "bg-slate-100 text-slate-600 ring-slate-300",
  NULL_UNAVAILABLE: "bg-sky-50 text-sky-700 ring-sky-300",
  STALE: "bg-amber-50 text-amber-800 ring-amber-300",
  SIMULATED: "bg-violet-50 text-violet-700 ring-violet-300",
  ESTIMATED_FALLBACK: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-300",
};

export const FALLBACK_PARAMS: ParamKey[] = ["current", "voltage"];

/**
 * Classify one parameter value for an AHU reading.
 * Precedence: UNINSTALLED > STALE > ESTIMATED_FALLBACK > NULL_UNAVAILABLE > SIMULATED > OK
 */
export function classifyQuality(opts: {
  param: ParamKey;
  installed: string[];
  value: number | null | undefined;
  fallbackFlag?: boolean | null;
  stale: boolean;
  source: DataSource | null;
}): DataQuality {
  if (!opts.installed.includes(opts.param)) return "UNINSTALLED";
  if (opts.stale) return "STALE";
  if (opts.fallbackFlag) return "ESTIMATED_FALLBACK";
  if (opts.value === null || opts.value === undefined || Number.isNaN(opts.value))
    return "NULL_UNAVAILABLE";
  if (opts.source === "SIMULATION") return "SIMULATED";
  return "OK";
}

/* ------------------------------------------------------------------ */
/* FR-04: AHU status computation                                      */
/* ------------------------------------------------------------------ */

export function computeAhuStatus(input: {
  lastSeenAt: Date | string | null;
  commTimeoutSec: number;
  faultCode?: string | null;
  hasCriticalAlarm?: boolean;
  fanSpeed?: number | null;
  runState?: string | null;
  now?: Date;
}): { status: AhuStatus; ageSec: number | null; stale: boolean } {
  const now = input.now ?? new Date();
  const lastSeen = input.lastSeenAt ? new Date(input.lastSeenAt) : null;
  const ageSec = lastSeen ? Math.max(0, (now.getTime() - lastSeen.getTime()) / 1000) : null;
  const stale = ageSec === null || ageSec > input.commTimeoutSec;

  const fault = Boolean(input.faultCode) || Boolean(input.hasCriticalAlarm);
  if (fault) return { status: "FAULT", ageSec, stale };
  if (stale) return { status: "OFFLINE", ageSec, stale };
  // Do not turn missing or contradictory feedback into a false STOP/RUN.
  const speedKnown = typeof input.fanSpeed === "number" && Number.isFinite(input.fanSpeed);
  if (input.runState === "RUN") {
    if (speedKnown && input.fanSpeed === 0) return { status: "OFFLINE", ageSec, stale: true };
    return { status: "RUN", ageSec, stale };
  }
  if (input.runState === "STOP") {
    if (speedKnown && (input.fanSpeed as number) > 0) return { status: "OFFLINE", ageSec, stale: true };
    return { status: "STOP", ageSec, stale };
  }
  if (!speedKnown) return { status: "OFFLINE", ageSec, stale: true };
  return { status: (input.fanSpeed as number) > 0 ? "RUN" : "STOP", ageSec, stale };
}

/** Matching feedback is necessary but not by itself proof of physical actuation. */
export function commandFeedbackMatches(
  command: string,
  reading: { runState: string | null; fanSpeed: number | null },
  echo: { setpoint: number | null; controlMode: string | null },
  target?: number,
): boolean {
  switch (command) {
    case "START":
      return reading.runState === "RUN" && reading.fanSpeed !== null && reading.fanSpeed > 0;
    case "STOP":
      return (
        (reading.runState === "STOP" && (reading.fanSpeed === null || reading.fanSpeed === 0)) ||
        (reading.runState === null && reading.fanSpeed === 0)
      );
    case "MODE_AUTO":
      return echo.controlMode === "AUTO";
    case "MODE_MANUAL":
      return echo.controlMode === "MANUAL";
    case "SETPOINT":
      return (
        typeof target === "number" &&
        typeof echo.setpoint === "number" &&
        Math.abs(echo.setpoint - target) < 0.05
      );
    default:
      return false;
  }
}

export const STATUS_STYLE: Record<AhuStatus, { badge: string; dot: string; label: string }> = {
  RUN: {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-300",
    dot: "bg-emerald-500 animate-pulse shadow-[0_0_10px_2px_rgba(16,185,129,0.7)]",
    label: "RUN",
  },
  STOP: {
    badge: "bg-slate-100 text-slate-700 ring-slate-300",
    dot: "bg-slate-500",
    label: "STOP",
  },
  FAULT: {
    badge: "bg-red-50 text-red-700 ring-red-300",
    dot: "bg-red-500 animate-ping-slow shadow-[0_0_10px_2px_rgba(239,68,68,0.8)]",
    label: "FAULT",
  },
  OFFLINE: {
    badge: "bg-rose-50 text-rose-700 ring-rose-300",
    dot: "bg-rose-500",
    label: "OFFLINE",
  },
};

export const PRIORITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-50 text-red-700 ring-red-300",
  HIGH: "bg-orange-50 text-orange-700 ring-orange-300",
  MEDIUM: "bg-amber-50 text-amber-800 ring-amber-300",
  LOW: "bg-sky-50 text-sky-700 ring-sky-300",
};

export const COMMAND_STATUS_STYLE: Record<string, string> = {
  REQUESTED: "bg-sky-50 text-sky-700 ring-sky-300",
  ACCEPTED: "bg-amber-50 text-amber-800 ring-amber-300",
  SUCCEEDED: "bg-emerald-50 text-emerald-700 ring-emerald-300",
  FAILED: "bg-red-50 text-red-700 ring-red-300",
  EXPIRED: "bg-slate-100 text-slate-700 ring-slate-300",
};

export const SOURCE_STYLE: Record<DataSource, string> = {
  PHYSICAL: "bg-cyan-50 text-cyan-800 ring-cyan-300",
  SIMULATION: "bg-violet-50 text-violet-700 ring-violet-300",
};

/* ------------------------------------------------------------------ */
/* RBAC matrix (FR-02 / NFR-03)                                       */
/* ------------------------------------------------------------------ */

export type Activity =
  | "view"
  | "ack"
  | "control"
  | "configure"
  | "viewAudit"
  | "manageUsers";

export const ROLES = ["Admin", "Engineering", "Operator"] as const;

export const RBAC: Record<Activity, ReadonlyArray<(typeof ROLES)[number]>> = {
  view: ["Admin", "Engineering", "Operator"],
  ack: ["Admin", "Engineering", "Operator"],
  control: ["Admin", "Engineering", "Operator"],
  configure: ["Admin", "Engineering"],
  viewAudit: ["Admin", "Engineering"],
  manageUsers: ["Admin"],
};

export function can(role: string | undefined | null, activity: Activity): boolean {
  if (!role) return false;
  return (RBAC[activity] as readonly string[]).includes(role);
}