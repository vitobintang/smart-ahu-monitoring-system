import type { AhuStatus } from "./ahu";

export type StatusInput = {
  lastReceivedAtMs: number | null;
  nowMs: number;
  timeoutMs: number;
  fault: boolean | null;
  running: boolean | null;
};

export function calculateAhuStatus(input: StatusInput): AhuStatus | null {
  const { lastReceivedAtMs, nowMs, timeoutMs, fault, running } = input;

  if (!Number.isFinite(nowMs) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return null;
  }

  // No telemetry has been received yet.
  if (lastReceivedAtMs === null) {
    return "OFFLINE";
  }

  // Invalid or future receive times cannot be trusted.
  if (!Number.isFinite(lastReceivedAtMs) || lastReceivedAtMs > nowMs) {
    return null;
  }

  // A unit is offline once its communication timeout has been reached.
  if (nowMs - lastReceivedAtMs >= timeoutMs) {
    return "OFFLINE";
  }

  if (fault === true) {
    return "FAULT";
  }

  // Don't guess whether a unit is running if feedback is missing.
  if (fault !== false) {
    return null;
  }

  if (running === true) {
    return "RUN";
  }

  if (running === false) {
    return "STOP";
  }

  return null;
}

export type CommunicationState =
  | "FRESH"
  | "STALE"
  | "NO_TELEMETRY"
  | "UNKNOWN";

export type LastFaultFlag =
  | "FAULT_REPORTED"
  | "NO_FAULT_REPORTED"
  | "UNKNOWN";

export type StatusDetails = {
  status: AhuStatus | null;
  communication: CommunicationState;
  lastFaultFlag: LastFaultFlag;
  faultFlagReceivedAtMs: number | null;
};

export function getStatusDetails(input: StatusInput): StatusDetails {
  const { lastReceivedAtMs, nowMs, timeoutMs, fault } = input;
  const status = calculateAhuStatus(input);

  const unknown: StatusDetails = {
    status,
    communication: "UNKNOWN",
    lastFaultFlag: "UNKNOWN",
    faultFlagReceivedAtMs: null,
  };

  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return unknown;
  }

  if (lastReceivedAtMs === null) {
    return { ...unknown, communication: "NO_TELEMETRY" };
  }

  if (!Number.isFinite(lastReceivedAtMs) || lastReceivedAtMs > nowMs) {
    return unknown;
  }

  const communication: CommunicationState =
    nowMs - lastReceivedAtMs >= timeoutMs ? "STALE" : "FRESH";

  if (fault !== true && fault !== false) {
    return { ...unknown, communication };
  }

  return {
    status,
    communication,
    lastFaultFlag: fault ? "FAULT_REPORTED" : "NO_FAULT_REPORTED",
    faultFlagReceivedAtMs: lastReceivedAtMs,
  };
}