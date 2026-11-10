import type { RtdbAdapter } from "./store";

/**
 * Integration with the OWNER's live device tree on an ADOPTED Firebase
 * project (daikinsmart-efeb7): the root `devices/{ahuId}` node written by the
 * existing Daikin S21 bridge. The app treats this node as the unit's LIVE
 * STATE + CONTROL surface:
 *
 *   read  — every sync tick maps its fields into the telemetry ingest pipeline
 *           (history, latest, thresholds/alarms, trends all flow from here)
 *   write — accepted START/STOP/SETPOINT commands patch power/setpoint so the
 *           owner's bridge drives the real AC
 *
 * Field reference (observed on devices/GTM-DAIKIN-001):
 *   capabilities: object   fan: string ("auto" | numeric)   mode: string ("cool")
 *   online: boolean        power: boolean                    room_temp: number
 *   rssi: number           s21_connected: boolean            setpoint: number
 *   simulated: boolean     source: string                    state_valid: boolean
 *   timestamp: number (epoch ms)
 */

/** The OWNER's live-state tree — intentionally the root `devices` name. */
export const DAIKIN_DEVICES_NODE = "devices";
/** The OWNER's token registry — deviceOwners/{id} holds the pre-shared bearer token (scalar). */
export const DAIKIN_OWNERS_NODE = "deviceOwners";
/**
 * VERIFIED against the real dump (2026-11-10): the live fields live one level
 * down at devices/{id}/status — the device node itself holds only that child.
 * Real status shape:
 *   capabilities { auto, heat, room_temp }  "supported" | "unsupported"
 *   fan          "auto" | numeric string
 *   mode         "cool" | ...
 *   online       boolean
 *   power        boolean
 *   room_temp    number
 *   rssi         number (dBm)
 *   s21_connected boolean
 *   setpoint     number
 *   simulated    boolean   (source "mock" + simulated true = bridge mock data)
 *   source       string
 *   state_valid  boolean
 *   timestamp    number (epoch ms)
 */
export const DAIKIN_STATUS_CHILD = "status";

export interface DaikinDeviceRecord {
  capabilities?: unknown;
  fan?: string;
  mode?: string;
  online?: boolean;
  power?: boolean;
  room_temp?: number;
  rssi?: number;
  s21_connected?: boolean;
  setpoint?: number;
  simulated?: boolean;
  source?: string;
  state_valid?: boolean;
  timestamp?: number;
}

/** True when the node exists AND carries the owner's Daikin bridge shape. */
export function isDaikinShape(value: unknown): value is DaikinDeviceRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return "power" in record || "room_temp" in record || "s21_connected" in record;
}

export async function readDaikinDevice(rtdb: RtdbAdapter, ahuId: string): Promise<DaikinDeviceRecord | null> {
  if (typeof ahuId !== "string" || !ahuId.trim() || ahuId.length > 128) return null;
  const node = await rtdb.get<unknown>(`${DAIKIN_DEVICES_NODE}/${ahuId}`);
  if (!node || typeof node !== "object") return null;
  // Real layout: the live fields sit at devices/{id}/status.
  const status = (node as Record<string, unknown>)[DAIKIN_STATUS_CHILD];
  if (status && typeof status === "object") return isDaikinShape(status) ? (status as DaikinDeviceRecord) : null;
  // Tolerate a flat node (older bridges / tests).
  return isDaikinShape(node) ? (node as DaikinDeviceRecord) : null;
}

export interface DaikinSample {
  messageId: string;
  timestampIso: string;
  parameters: Record<string, number | null>;
  runState?: "RUN" | "STOP";
  setpoint?: number;
  source: "PHYSICAL" | "SIMULATION";
}

/**
 * Maps a bridge record onto one ingest sample. Returns null when the record is
 * unusable right now (invalid state, no usable timestamp).
 */
export function mapDaikinToSample(record: DaikinDeviceRecord, ahuId: string, now = Date.now()): DaikinSample | null {
  if (record.state_valid === false) return null;

  // A bridge record without a usable timestamp is malformed — skipping is
  // safer than fabricating `now` (the dedup key would churn every tick).
  if (typeof record.timestamp !== "number" || !Number.isFinite(record.timestamp)) return null;
  const stamp = record.timestamp;
  const timestampIso = new Date(stamp).toISOString();
  if (Number.isNaN(new Date(timestampIso).getTime())) return null;

  const parameters: Record<string, number | null> = {};
  if (typeof record.room_temp === "number" && Number.isFinite(record.room_temp)) {
    parameters.roomTemp = record.room_temp;
  }
  // "fan" may be "auto" (no numeric speed) or a numeric level string.
  const fanSpeed = typeof record.fan === "string" && /^\d+(\.\d+)?$/.test(record.fan.trim()) ? Number(record.fan.trim()) : null;
  parameters.fanSpeed = fanSpeed;

  const sample: DaikinSample = {
    // Timestamp-keyed id → re-reading an unchanged bridge is a natural dedup.
    messageId: `s21-${ahuId}-${stamp}`,
    timestampIso,
    parameters,
    source: record.simulated === true ? "SIMULATION" : "PHYSICAL",
  };
  if (record.power === true) sample.runState = "RUN";
  else if (record.power === false) sample.runState = "STOP";
  if (typeof record.setpoint === "number" && Number.isFinite(record.setpoint)) sample.setpoint = record.setpoint;
  return sample;
}

/**
 * Control write-through for the owner's bridge. Returns false when the target
 * node is absent or not Daikin-shaped (nothing was written). Only the fields
 * the bridge understands are patched — never the whole record.
 */
export async function writeDaikinControl(
  rtdb: RtdbAdapter,
  ahuId: string,
  patch: { power?: boolean; setpoint?: number },
): Promise<boolean> {
  if (!(await readDaikinDevice(rtdb, ahuId))) return false;
  const values: Record<string, unknown> = {};
  if (typeof patch.power === "boolean") values.power = patch.power;
  if (typeof patch.setpoint === "number" && Number.isFinite(patch.setpoint)) values.setpoint = patch.setpoint;
  if (Object.keys(values).length === 0) return false;
  await rtdb.update(`${DAIKIN_DEVICES_NODE}/${ahuId}/${DAIKIN_STATUS_CHILD}`, values);
  return true;
}

export interface AcceptedCommandLike {
  id: string;
  ahuId?: string;
  commandType?: string;
  payload?: { setpoint?: number } | null;
}

/**
 * Maps accepted command records onto bridge control writes:
 * START → power:true, STOP → power:false, SETPOINT → setpoint.
 * (MODE_AUTO/MODE_MANUAL have no Daikin counterpart and are ignored here.)
 */
export function commandsToControlPatch(commands: AcceptedCommandLike[]): { power?: boolean; setpoint?: number } {
  const patch: { power?: boolean; setpoint?: number } = {};
  for (const command of commands) {
    if (command.commandType === "START") patch.power = true;
    else if (command.commandType === "STOP") patch.power = false;
    else if (command.commandType === "SETPOINT") {
      const setpoint = Number(command.payload?.setpoint);
      if (Number.isFinite(setpoint)) patch.setpoint = setpoint;
    }
  }
  return patch;
}

/* ------------------------------------------------------------------------- */
/* deviceOwners — the pre-shared device tokens                                */
/* ------------------------------------------------------------------------- */

/** The pre-shared bearer token for a device (scalar string), or null. */
export async function readDeviceOwnerToken(owner: RtdbAdapter, ahuId: string): Promise<string | null> {
  if (typeof ahuId !== "string" || !ahuId.trim() || ahuId.length > 128) return null;
  const value = await owner.get<unknown>(`${DAIKIN_OWNERS_NODE}/${ahuId}`);
  return typeof value === "string" && value.trim() ? value : null;
}

/** Registers/overwrites a device token (Admin "input token" flow). */
export async function writeDeviceOwnerToken(owner: RtdbAdapter, ahuId: string, token: string): Promise<void> {
  await owner.set(`${DAIKIN_OWNERS_NODE}/${ahuId}`, token);
}

/** Reverse lookup: which device id does this bearer token belong to? */
export async function findDeviceIdByToken(owner: RtdbAdapter, token: string): Promise<string | null> {
  if (typeof token !== "string" || !token) return null;
  const tree = (await owner.get<Record<string, string>>(DAIKIN_OWNERS_NODE)) ?? {};
  for (const [id, value] of Object.entries(tree)) {
    if (typeof value === "string" && value === token) return id;
  }
  return null;
}

/** Initial `devices/{id}/status` record for a freshly registered unit — fields per the VERIFIED dump. */
export function initialDaikinDeviceStatus(now = Date.now()): Record<string, unknown> {
  return {
    fan: "auto",
    mode: "cool",
    online: false,
    power: false,
    s21_connected: false,
    setpoint: 24,
    simulated: false,
    state_valid: false,
    timestamp: now,
  };
}
