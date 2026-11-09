import type { RtdbAdapter } from "./store";

/**
 * Registry trees (Phase 5b) — the AHU registry, its data-source devices and
 * the per-sensor alarm thresholds.
 *
 * Tree layout (`ahus` / `devices` / `sensor_thresholds`
 * tables; epoch-ms timestamps):
 *   ahus/{ahuId}                        → full AHU registry record
 *   devices/{ahuId}/{deviceId}          → data-source device (incl. bearer token)
 *   thresholds/{ahuId}/{parameter}      → alarm threshold configuration
 *
 * Devices carry their bearer token: ingestTelemetry authenticates by token,
 * and under the locked database rules only the Admin SDK (server) can ever
 * read this tree — server-only trust boundary.
 *
 * These are the authoritative RTDB registry reads, fed by a
 * one-shot backfill (scripts/export-registry-to-rtdb.mjs) and kept in sync by
 * writes on every mutation path.
 */

export const AHUS_NODE = "ahus";
export const DEVICES_NODE = "devices";
export const THRESHOLDS_NODE = "thresholds";

/** Epoch-ms flattened `ahus` row. */
export interface RtdbAhuRecord {
  id: string;
  name: string;
  location: string;
  commTimeoutSec: number;
  hasHeater: boolean;
  installedSensors: string[];
  /** OFFLINE | ONLINE | RUN | FAULT (schema enum values). */
  currentStatus: string;
  lastSeenAt: number | null;
  /** AUTO | MANUAL. */
  controlMode: string;
  /** START | STOP. */
  desiredRunState: string;
  setpoint: number;
  faultCode: string | null;
  physicalControlEnabled: boolean;
  mapX: number | null;
  mapZ: number | null;
  mapRotation: number;
  mapZone: string | null;
  updatedAt: number;
}

/** Epoch-ms flattened `devices` row. */
export interface RtdbDeviceRecord {
  id: string;
  ahuId: string;
  label: string;
  /** Bearer token used by telemetry ingest — server-only data. */
  token: string;
  /** PHYSICAL | SIMULATION. */
  sourceType: string;
  enabled: boolean;
  createdAt: number;
}

/** Epoch-ms flattened `sensor_thresholds` row (the table itself has no timestamps). */
export interface RtdbThresholdRecord {
  id: string;
  ahuId: string;
  parameter: string;
  enabled: boolean;
  lowLimit: number | null;
  highLimit: number | null;
  delaySec: number;
  /** LOW | MEDIUM | HIGH | CRITICAL | COMMUNICATION. */
  priority: string;
  validMin: number | null;
  validMax: number | null;
  unit: string | null;
  label: string | null;
  trendEnabled: boolean;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

/** Full-record upsert (backfill + provisioning). */
export async function writeRtdbAhu(rtdb: RtdbAdapter, record: RtdbAhuRecord): Promise<void> {
  await rtdb.set(`${AHUS_NODE}/${record.id}`, record);
}

/** Merge-patch a single AHU (status changes, control updates, config edits). */
export async function patchRtdbAhu(rtdb: RtdbAdapter, ahuId: string, patch: Partial<Omit<RtdbAhuRecord, "id">>): Promise<void> {
  await rtdb.update(`${AHUS_NODE}/${ahuId}`, { ...patch, updatedAt: patch.updatedAt ?? Date.now() });
}

export async function setRtdbDevice(rtdb: RtdbAdapter, record: RtdbDeviceRecord): Promise<void> {
  await rtdb.set(`${DEVICES_NODE}/${record.ahuId}/${record.id}`, record);
}

export async function removeRtdbDevice(rtdb: RtdbAdapter, ahuId: string, deviceId: string): Promise<void> {
  await rtdb.remove(`${DEVICES_NODE}/${ahuId}/${deviceId}`);
}

export async function setRtdbThreshold(rtdb: RtdbAdapter, record: RtdbThresholdRecord): Promise<void> {
  await rtdb.set(`${THRESHOLDS_NODE}/${record.ahuId}/${record.parameter}`, record);
}

export async function removeRtdbThreshold(rtdb: RtdbAdapter, ahuId: string, parameter: string): Promise<void> {
  await rtdb.remove(`${THRESHOLDS_NODE}/${ahuId}/${parameter}`);
}

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

/** All AHU registry records keyed by id. */
export async function readRtdbAhus(rtdb: RtdbAdapter): Promise<Map<string, RtdbAhuRecord>> {
  const tree = (await rtdb.get<Record<string, RtdbAhuRecord>>(AHUS_NODE)) ?? {};
  return new Map(Object.entries(tree));
}

export async function readRtdbAhu(rtdb: RtdbAdapter, ahuId: string): Promise<RtdbAhuRecord | null> {
  return rtdb.get<RtdbAhuRecord>(`${AHUS_NODE}/${ahuId}`);
}

/** Device records, optionally narrowed to one AHU. */
export async function readRtdbDevices(rtdb: RtdbAdapter, ahuId?: string): Promise<RtdbDeviceRecord[]> {
  if (ahuId) {
    const tree = (await rtdb.get<Record<string, RtdbDeviceRecord>>(`${DEVICES_NODE}/${ahuId}`)) ?? {};
    return Object.values(tree);
  }
  const tree = (await rtdb.get<Record<string, Record<string, RtdbDeviceRecord>>>(DEVICES_NODE)) ?? {};
  return Object.values(tree).flatMap((perAhu) => Object.values(perAhu));
}

/** Ingest authentication: the device record owning this bearer token, if any. */
export async function readRtdbDeviceByToken(rtdb: RtdbAdapter, token: string): Promise<RtdbDeviceRecord | null> {
  const all = await readRtdbDevices(rtdb);
  return all.find((d) => d.token === token && d.enabled) ?? null;
}

/** sourceType values of the AHU's enabled devices (engine/commands gate). */
export async function readRtdbEnabledSourceTypes(rtdb: RtdbAdapter, ahuId: string): Promise<string[]> {
  const devices = await readRtdbDevices(rtdb, ahuId);
  return devices.filter((d) => d.enabled).map((d) => d.sourceType);
}

/** Threshold records, optionally narrowed to one AHU. */
export async function readRtdbThresholds(rtdb: RtdbAdapter, ahuId?: string): Promise<RtdbThresholdRecord[]> {
  const tree = ahuId
    ? ((await rtdb.get<Record<string, RtdbThresholdRecord>>(`${THRESHOLDS_NODE}/${ahuId}`)) ?? {})
    : ((await rtdb.get<Record<string, Record<string, RtdbThresholdRecord>>>(THRESHOLDS_NODE)) ?? {});
  return ahuId ? Object.values(tree) : Object.values(tree).flatMap((perAhu) => Object.values(perAhu));
}

/* ------------------------------------------------------------------ */
/* Row mappers (row shapes → JSON API compatibility)  */
/* ------------------------------------------------------------------ */

export function ahuToRow(record: RtdbAhuRecord): Record<string, unknown> {
  // `n()` restores nulls RTDB stripped (see live-read.ts).
  const n = <T,>(value: T | undefined): T | null => (value === undefined ? null : (value as T));
  return {
    id: record.id,
    name: record.name,
    location: record.location,
    commTimeoutSec: record.commTimeoutSec,
    hasHeater: record.hasHeater,
    installedSensors: record.installedSensors ?? [],
    currentStatus: record.currentStatus,
    lastSeenAt: record.lastSeenAt == null ? null : new Date(record.lastSeenAt),
    controlMode: record.controlMode,
    desiredRunState: record.desiredRunState,
    setpoint: record.setpoint,
    faultCode: n(record.faultCode),
    physicalControlEnabled: record.physicalControlEnabled,
    mapX: n(record.mapX),
    mapZ: n(record.mapZ),
    mapRotation: record.mapRotation,
    mapZone: n(record.mapZone),
  };
}

export function deviceToRow(record: RtdbDeviceRecord): Record<string, unknown> {
  return {
    id: record.id,
    ahuId: record.ahuId,
    label: record.label,
    token: record.token,
    sourceType: record.sourceType,
    enabled: record.enabled,
    createdAt: new Date(record.createdAt),
  };
}

export function thresholdToRow(record: RtdbThresholdRecord): Record<string, unknown> {
  // `n()` restores nulls RTDB stripped (see live-read.ts).
  const n = <T,>(value: T | undefined): T | null => (value === undefined ? null : (value as T));
  return {
    id: record.id,
    ahuId: record.ahuId,
    parameter: record.parameter,
    enabled: record.enabled,
    lowLimit: n(record.lowLimit),
    highLimit: n(record.highLimit),
    delaySec: record.delaySec,
    priority: record.priority,
    validMin: n(record.validMin),
    validMax: n(record.validMax),
    unit: n(record.unit),
    label: n(record.label),
    trendEnabled: record.trendEnabled,
  };
}
