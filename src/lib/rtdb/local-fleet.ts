import type { RtdbAdapter } from "./store";
import { defaultAhuRecord, readRtdbAhus, THRESHOLDS_NODE, writeRtdbAhu, type RtdbAhuRecord } from "./registry";
import { suggestAcDeviceSlot } from "@/lib/facility-placement";

/**
 * LOCAL FLEET (2026-11-10) — a fictional device tree hosted in the APP's own
 * database, shaped exactly like the collaborator's daikinsmart tree so the
 * existing daikin ingest/write-through pipeline drives it unchanged:
 *
 *   localDevices/{id}/status   — power, setpoint, room_temp, timestamp …
 *   localDeviceOwners/{id}     — scalar bearer token (same structure as deviceOwners)
 *
 * The DB switch (settings/deviceSource = "daikin" | "local") changes ONLY the
 * device-data source: "daikin" mirrors the real owner tree (single real unit),
 * "local" ingests the fictional fleet below. Auth, users, rooms, alarms, audit
 * and all app metadata are untouched.
 *
 * The simulator tick updates ONLY telemetry fields (room_temp, rssi, online,
 * state_valid, timestamp) and never power/setpoint — those belong to the
 * website (the exact contract the real bridge must also obey).
 */

export const LOCAL_DEVICES_NODE = "localDevices";
export const LOCAL_OWNERS_NODE = "localDeviceOwners";
export const DEVICE_SOURCE_NODE = "settings/deviceSource";

export type DeviceSource = "daikin" | "local";

const AMBIENT_C = 27.5;

export interface LocalFleetUnitSpec {
  id: string;
  name: string;
  location: string;
  deviceType: "AHU" | "AC_DAK" | "AC_SPLIT_WALL" | "AC_STANDING";
  setpoint: number;
  hasHeater: boolean;
}

/** The fictional fleet: 1 AHU, 2 AC DAK, 1 AC standing, 3 AC split wall. */
export const LOCAL_FLEET: LocalFleetUnitSpec[] = [
  { id: "LOC-AHU-01", name: "Local AHU 01 — Plant Room", location: "Plant Room", deviceType: "AHU", setpoint: 22, hasHeater: true },
  { id: "LOC-DAK-01", name: "Local Cassette 01 — Meeting Room", location: "Meeting Room", deviceType: "AC_DAK", setpoint: 24, hasHeater: false },
  { id: "LOC-DAK-02", name: "Local Cassette 02 — Open Office", location: "Open Office", deviceType: "AC_DAK", setpoint: 24, hasHeater: false },
  { id: "LOC-STD-01", name: "Local Standing 01 — Lobby", location: "Lobby", deviceType: "AC_STANDING", setpoint: 23, hasHeater: false },
  { id: "LOC-SPLIT-01", name: "Local Split 01 — Office A", location: "Office A", deviceType: "AC_SPLIT_WALL", setpoint: 24, hasHeater: false },
  { id: "LOC-SPLIT-02", name: "Local Split 02 — Office B", location: "Office B", deviceType: "AC_SPLIT_WALL", setpoint: 24, hasHeater: false },
  { id: "LOC-SPLIT-03", name: "Local Split 03 — Corridor", location: "Corridor", deviceType: "AC_SPLIT_WALL", setpoint: 25, hasHeater: false },
];

export function isDeviceSource(value: unknown): value is DeviceSource {
  return value === "daikin" || value === "local";
}

export async function readDeviceSource(rtdb: RtdbAdapter): Promise<DeviceSource> {
  const value = await rtdb.get<string>(DEVICE_SOURCE_NODE);
  return isDeviceSource(value) ? value : "daikin";
}

export async function writeDeviceSource(rtdb: RtdbAdapter, source: DeviceSource): Promise<void> {
  await rtdb.set(DEVICE_SOURCE_NODE, source);
}

/** A daikin-shaped status node — byte-for-byte the same fields as the real tree. */
export function localStatusNode(
  spec: LocalFleetUnitSpec,
  now = Date.now(),
  overrides?: { power?: boolean; setpoint?: number; room_temp?: number },
): Record<string, unknown> {
  return {
    capabilities: { auto: "unsupported", heat: spec.hasHeater ? "supported" : "unsupported", room_temp: "supported" },
    fan: "auto",
    mode: "cool",
    online: true,
    power: overrides?.power ?? false,
    room_temp: overrides?.room_temp ?? AMBIENT_C,
    rssi: -48,
    s21_connected: true,
    setpoint: overrides?.setpoint ?? spec.setpoint,
    simulated: true,
    source: "local",
    state_valid: true,
    timestamp: now,
  };
}

function localToken(id: string): string {
  // Deterministic pseudo-token (NOT a secret): marks the unit in localDeviceOwners.
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `loc-${h.toString(16).padStart(8, "0")}-${id.toLowerCase()}`;
}

/** Idempotent: creates the 7 fictional device nodes + registry entries on first switch to "local". */
export async function ensureLocalFleet(rtdb: RtdbAdapter): Promise<string[]> {
  const now = Date.now();
  const registry = await readRtdbAhus(rtdb);
  const existingCoords: Array<{ id: string; x: number; z: number; rotation?: number }> = [];
  for (const r of [...registry.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (r.mapX !== null && r.mapZ !== null) {
      existingCoords.push({ id: r.id, x: r.mapX, z: r.mapZ, rotation: r.mapRotation });
    }
  }

  const created: string[] = [];
  for (const spec of LOCAL_FLEET_SPEC_PLUS_HEATER) {
    const statusPath = `${LOCAL_DEVICES_NODE}/${spec.id}/status`;
    const existing = await rtdb.get<Record<string, unknown>>(statusPath);
    if (!existing) {
      await rtdb.set(statusPath, localStatusNode(spec, now));
      await rtdb.set(`${LOCAL_OWNERS_NODE}/${spec.id}`, localToken(spec.id));
      created.push(spec.id);
    }

    if (!registry.has(spec.id)) {
      const record = defaultAhuRecord(spec.id, now);
      const placed =
        spec.deviceType === "AHU"
          ? suggestAcDeviceSlot("AC_STANDING", existingCoords, null) // indoor floor slot for the AHU plinth
          : suggestAcDeviceSlot(spec.deviceType, existingCoords, null);
      const next: RtdbAhuRecord = {
        ...record,
        id: spec.id,
        name: spec.name,
        location: spec.location,
        deviceType: spec.deviceType,
        hasHeater: spec.hasHeater,
        setpoint: spec.setpoint,
        fleetSource: "local",
        installedSensors:
          spec.deviceType === "AHU"
            ? ["roomTemp", "supplyTemp", "returnTemp", "fanSpeed"]
            : ["roomTemp", "fanSpeed"],
        mapX: placed.x,
        mapZ: placed.z,
        mapRotation: placed.rotation,
        mapZone: placed.zone.label,
        physicalControlEnabled: true,
        lastSeenAt: now,
        currentStatus: "ONLINE",
      };
      await writeRtdbAhu(rtdb, next);
      existingCoords.push({ id: spec.id, x: placed.x, z: placed.z, rotation: placed.rotation });

      // Same threshold shape as the provisioned real unit.
      const nowStr = new Date(now).toISOString();
      await rtdb.set(`${THRESHOLDS_NODE}/${spec.id}`, {
        roomTemp: {
          id: `${spec.id}:roomTemp`, ahuId: spec.id, parameter: "roomTemp", enabled: true,
          lowLimit: 18, highLimit: 30, delaySec: 30, priority: "MEDIUM", validMin: null, validMax: null,
          unit: "°C", label: "Room Temp", trendEnabled: true, updatedAt: nowStr,
        },
        fanSpeed: {
          id: `${spec.id}:fanSpeed`, ahuId: spec.id, parameter: "fanSpeed", enabled: true,
          lowLimit: 0, highLimit: 5, delaySec: 30, priority: "LOW", validMin: null, validMax: null,
          unit: "level", label: "Fan Speed", trendEnabled: false, updatedAt: nowStr,
        },
      });
    }
  }
  return created;
}

// Small indirection so the specs above stay frozen while seeding can map types.
const LOCAL_FLEET_SPEC_PLUS_HEATER = LOCAL_FLEET;

/**
 * Advances the fictional fleet ONE tick — telemetry only. Power/setpoint are
 * owned by the website's write-through and are never touched here.
 */
export async function localFleetTick(rtdb: RtdbAdapter): Promise<number> {
  const tree = (await rtdb.get<Record<string, Record<string, unknown>>>(LOCAL_DEVICES_NODE)) ?? {};
  const now = Date.now();
  let updated = 0;
  for (const [id, node] of Object.entries(tree)) {
    const status = (node?.status ?? null) as Record<string, unknown> | null;
    if (!status) continue;
    const power = status.power === true;
    const setpoint = typeof status.setpoint === "number" ? status.setpoint : 24;
    const current = typeof status.room_temp === "number" ? status.room_temp : AMBIENT_C;
    // Cool toward setpoint when running, relax to ambient when off (0.12–0.2 °C per 5 s tick).
    const target = power ? setpoint : AMBIENT_C;
    const rate = power ? 0.18 : 0.1;
    const jitter = (Math.random() - 0.5) * 0.06;
    const gap = target - current;
    const nextTemp = Math.round((current + Math.sign(gap) * Math.min(Math.abs(gap), rate) + jitter) * 100) / 100;
    const rssi = Math.max(-72, Math.min(-40, (typeof status.rssi === "number" ? status.rssi : -52) + Math.round((Math.random() - 0.5) * 4)));
    await rtdb.update(`${LOCAL_DEVICES_NODE}/${id}/status`, {
      room_temp: nextTemp,
      rssi,
      online: true,
      state_valid: true,
      timestamp: now,
    });
    updated += 1;
  }
  return updated;
}

/**
 * Registry rows of the ACTIVE fleet only (settings/deviceSource). Units carry
 * fleetSource ("local" for the fictional fleet, "daikin" otherwise/legacy).
 */
export async function readActiveFleetRecords(rtdb: RtdbAdapter): Promise<Map<string, RtdbAhuRecord>> {
  const [registry, source] = await Promise.all([readRtdbAhus(rtdb), readDeviceSource(rtdb)]);
  const active = new Map<string, RtdbAhuRecord>();
  for (const [id, record] of registry) {
    if ((record.fleetSource ?? "daikin") === source) active.set(id, record);
  }
  return active;
}

/** Ids of the local fleet that currently exist in the app DB. */
export async function listLocalDeviceIds(rtdb: RtdbAdapter): Promise<string[]> {
  const tree = (await rtdb.get<Record<string, unknown>>(LOCAL_DEVICES_NODE)) ?? {};
  return Object.keys(tree).sort();
}
