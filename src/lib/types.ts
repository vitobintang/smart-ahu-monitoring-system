/**
 * Shared domain types (PostgreSQL-free since Phase 5c).
 *
 * These mirror the record shapes the API previously returned from the
 * src/db/schema.ts; they are now plain TypeScript unions/interfaces with
 * identical shapes, so every consumer keeps its exact types.
 */

export type Role = "Admin" | "Engineering" | "Operator";
export type AhuStatus = "RUN" | "STOP" | "FAULT" | "OFFLINE";
export type DataSource = "PHYSICAL" | "SIMULATION";
export type CommandStatus = "REQUESTED" | "ACCEPTED" | "SUCCEEDED" | "FAILED" | "EXPIRED";
export type AlarmPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ControlMode = "AUTO" | "MANUAL";
export type RunState = "RUN" | "STOP";

/** User profile row shape (now persisted in RTDB `users/{uid}`). */
export interface UserRow {
  id: string;
  email: string;
  username: string | null;
  fullName: string | null;
  role: Role;
  createdAt: Date;
}

/** AHU registry row shape (now persisted in RTDB `ahus/{id}`). */
export interface AhuRow {
  id: string;
  name: string;
  location: string;
  commTimeoutSec: number;
  hasHeater: boolean;
  installedSensors: string[];
  currentStatus: AhuStatus;
  lastSeenAt: Date | null;
  controlMode: ControlMode;
  desiredRunState: RunState;
  setpoint: number;
  faultCode: string | null;
  physicalControlEnabled: boolean;
  mapX: number | null;
  mapZ: number | null;
  mapRotation: number;
  mapZone: string | null;
}

/** Data-source device row shape (now persisted in RTDB `devices/{ahu}/{id}`). */
export interface DeviceRow {
  id: string;
  ahuId: string;
  label: string;
  token: string;
  sourceType: DataSource;
  enabled: boolean;
  createdAt: Date;
}
