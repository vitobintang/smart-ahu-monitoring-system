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