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

export const AHUS_NODE = "devices";
/**
 * The APP database mirrors the OWNER project's layout: the fleet tree is
 * `devices/{id}` — a verbatim copy of the owner's live device node — with all
 * app-owned registry metadata (name, location, placement, control flags)
 * nested under `devices/{id}/app`. Sync (workers.ts) only ever writes the
 * snapshot's own fields, never the `app/` subtree; registry writers only ever
 * touch `app/`.
 */
export const DEVICE_MIRROR_NODE = "devices";
export const APP_META_CHILD = "app";
export const THRESHOLDS_NODE = "thresholds";

/** Epoch-ms flattened `ahus` row (stored at devices/{id}/app). */
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
  /** Pause switch: when false the sampler skips the unit entirely. */
  enabled?: boolean;
  mapX: number | null;
  mapZ: number | null;
  mapRotation: number;
  mapZone: string | null;
  updatedAt: number;
}

/** Sensible registry defaults for a device discovered on the mirror tree. */
export function defaultAhuRecord(ahuId: string, now = Date.now()): RtdbAhuRecord {
  return {
    id: ahuId,
    name: ahuId,
    location: "",
    commTimeoutSec: 90,
    hasHeater: false,
    installedSensors: ["roomTemp", "supplyTemp", "returnTemp", "fanSpeed"],
    currentStatus: "OFFLINE",
    lastSeenAt: null,
    controlMode: "AUTO",
    desiredRunState: "STOP",
    setpoint: 24,
    faultCode: null,
    physicalControlEnabled: false,
    enabled: true,
    mapX: null,
    mapZ: null,
    mapRotation: 0,
    mapZone: null,
    updatedAt: now,
  };
}

function appMetaOf(record: RtdbAhuRecord): Record<string, unknown> {
  const { id: _id, ...meta } = record;
  void _id;
  return meta as Record<string, unknown>;
}

function recordFromNode(ahuId: string, node: unknown): RtdbAhuRecord {
  const app = (node && typeof node === "object" ? (node as Record<string, unknown>).app : null) as
    | Partial<Omit<RtdbAhuRecord, "id">>
    | null;
  return { ...defaultAhuRecord(ahuId), ...(app ?? {}), id: ahuId };
}

/**
 * Bearer-token gateway registry — RETIRED. Device authentication now lives on
 * the OWNER project's deviceOwners/{id} (pre-shared tokens), and data flows
 * through the sampler/mirror, not push ingestion. The interface stays for the
 * admin devices tab, synthesized from the fleet tree.
 */
export interface RtdbDeviceRecord {
  id: string;
  ahuId: string;
  label: string;
  token: string;
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

/** Full-record upsert (backfill + provisioning) — writes devices/{id}/app. */
export async function writeRtdbAhu(rtdb: RtdbAdapter, record: RtdbAhuRecord): Promise<void> {
  await rtdb.set(`${DEVICE_MIRROR_NODE}/${record.id}/${APP_META_CHILD}`, appMetaOf(record));
}

/** Merge-patch a single AHU (status changes, control updates, config edits). */
export async function patchRtdbAhu(rtdb: RtdbAdapter, ahuId: string, patch: Partial<Omit<RtdbAhuRecord, "id">>): Promise<void> {
  await rtdb.update(`${DEVICE_MIRROR_NODE}/${ahuId}/${APP_META_CHILD}`, { ...patch, updatedAt: patch.updatedAt ?? Date.now() });
}

/** Remove a unit's app-owned registry metadata (the mirrored fields remain). */
export async function removeRtdbAhuMeta(rtdb: RtdbAdapter, ahuId: string): Promise<void> {
  await rtdb.remove(`${DEVICE_MIRROR_NODE}/${ahuId}/${APP_META_CHILD}`);
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

/** All fleet units keyed by id — every device node on the mirror tree. */
export async function readRtdbAhus(rtdb: RtdbAdapter): Promise<Map<string, RtdbAhuRecord>> {
  const tree = (await rtdb.get<Record<string, unknown>>(DEVICE_MIRROR_NODE)) ?? {};
  const out = new Map<string, RtdbAhuRecord>();
  for (const [id, node] of Object.entries(tree)) {
    if (node && typeof node === "object") out.set(id, recordFromNode(id, node));
  }
  return out;
}

export async function readRtdbAhu(rtdb: RtdbAdapter, ahuId: string): Promise<RtdbAhuRecord | null> {
  const node = await rtdb.get<unknown>(`${DEVICE_MIRROR_NODE}/${ahuId}`);
  if (!node || typeof node !== "object") return null;
  return recordFromNode(ahuId, node);
}

/** Fleet rows for the admin devices tab (gateway registry is retired). */
export async function readRtdbDevices(rtdb: RtdbAdapter, ahuId?: string): Promise<RtdbDeviceRecord[]> {
  const ahus = await readRtdbAhus(rtdb);
  const rows: RtdbDeviceRecord[] = [];
  for (const [id, record] of ahus) {
    if (ahuId && id !== ahuId) continue;
    rows.push({
      id: `owner-${id}`,
      ahuId: id,
      label: "Daikin S21 device (owner tree)",
      token: "(pre-shared token — owner project)",
      sourceType: "PHYSICAL",
      enabled: record.enabled !== false,
      createdAt: record.updatedAt,
    });
  }
  return rows;
}

/** Source gates for commands: the unit exists and is enabled. */
export async function readRtdbEnabledSourceTypes(rtdb: RtdbAdapter, ahuId: string): Promise<string[]> {
  const ahu = await readRtdbAhu(rtdb, ahuId);
  if (!ahu || !ahu.enabled) return [];
  return ["PHYSICAL", "SIMULATION"];
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
    token: "(pre-shared token — owner project)",
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
