import type { RtdbAdapter } from "./store";

/**
 * Command records in the Realtime Database (Phase 2 Slice C).
 *
 * Tree layout (mirrors the PostgreSQL `ahu_commands` table):
 *   commands/{commandId}       → full command record (epoch-ms timestamps)
 *   commandActive/{ahuId}      → the single active-command slot per AHU
 *
 * The one-active-command-per-AHU invariant (FR-26) is enforced in RTDB with a
 * transaction on the slot: claiming aborts while an unexpired slot is held,
 * mirroring the PostgreSQL partial unique index + advisory lock. Terminal
 * transitions (SUCCEEDED/FAILED/EXPIRED) clear the slot — but only when it
 * still belongs to that command.
 *
 * Phase 2 runs this as a dual-write mirror: PostgreSQL stays authoritative
 * until the Phase 5 cutover; mirror failures are logged and dropped.
 */

export const COMMANDS_NODE = "commands";
export const COMMAND_ACTIVE_NODE = "commandActive";

export type RtdbCommandStatus = "REQUESTED" | "ACCEPTED" | "SUCCEEDED" | "FAILED" | "EXPIRED";

/** Epoch-ms flattened `ahu_commands` row. */
export interface RtdbCommandRecord {
  id: string;
  ahuId: string;
  userId: string;
  userEmail: string | null;
  commandType: string;
  payload: Record<string, number | string | boolean> | null;
  status: RtdbCommandStatus;
  rejectionReason: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  confirmedAt: number | null;
}

/** The single active-command slot held per AHU. */
export interface RtdbActiveCommandSlot {
  commandId: string;
  commandType: string;
  status: Exclude<RtdbCommandStatus, "SUCCEEDED" | "FAILED" | "EXPIRED">;
  createdAt: number;
  expiresAt: number;
}

export function commandNode(commandId: string): string {
  return `${COMMANDS_NODE}/${commandId}`;
}

export function commandActiveNode(ahuId: string): string {
  return `${COMMAND_ACTIVE_NODE}/${ahuId}`;
}

export function activeSlotFor(record: RtdbCommandRecord): RtdbActiveCommandSlot {
  return {
    commandId: record.id,
    commandType: record.commandType,
    status: record.status as RtdbActiveCommandSlot["status"],
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

/** Writes/overwrites the full command record (idempotent per commandId). */
export function writeRtdbCommand(rtdb: RtdbAdapter, record: RtdbCommandRecord): Promise<void> {
  return rtdb.set(commandNode(record.id), record);
}

/**
 * Transactionally claims the AHU's active-command slot. Aborts (committed:
 * false) while an unexpired slot is held — the RTDB form of the
 * one-active-command-per-AHU guarantee. An expired slot may be replaced.
 */
export function claimActiveCommand(
  rtdb: RtdbAdapter,
  ahuId: string,
  slot: RtdbActiveCommandSlot,
  now: number = Date.now(),
): Promise<{ committed: boolean }> {
  return rtdb.transaction<RtdbActiveCommandSlot>(commandActiveNode(ahuId), (current) => {
    // occupied by ANOTHER unexpired command — abort; expired slots and
    // re-claims of the same command proceed (idempotent mirror writes)
    if (current && current.expiresAt > now && current.commandId !== slot.commandId) return undefined;
    return slot; // free (or expired, or ours) — claim it
  });
}

/** Updates the slot's status while its command is still active (REQUESTED/ACCEPTED). */
export function updateActiveCommandStatus(
  rtdb: RtdbAdapter,
  ahuId: string,
  commandId: string,
  status: RtdbActiveCommandSlot["status"],
): Promise<void> {
  return rtdb
    .transaction<RtdbActiveCommandSlot>(commandActiveNode(ahuId), (current) => {
      if (!current || current.commandId !== commandId) return undefined; // not ours / gone — no-op
      return { ...current, status };
    })
    .then(() => undefined);
}

/**
 * Clears the AHU's slot, but only when it still belongs to `commandId` —
 * a superseding command must never be evicted by a stale transition.
 */
export function clearActiveCommand(
  rtdb: RtdbAdapter,
  ahuId: string,
  commandId: string,
): Promise<{ committed: boolean }> {
  return rtdb.transaction<RtdbActiveCommandSlot>(commandActiveNode(ahuId), (current) => {
    if (!current || current.commandId !== commandId) return undefined; // not ours — keep, abort
    return null; // remove
  });
}

export interface CommandStatusPatch {
  id: string;
  ahuId: string;
  status: RtdbCommandStatus;
  updatedAt: number;
  rejectionReason?: string | null;
  confirmedAt?: number | null;
}

/**
 * Applies a lifecycle transition to the mirror: patches `commands/{id}` and
 * keeps (REQUESTED/ACCEPTED) or clears (terminal) the active slot.
 */
export async function applyCommandStatusPatch(rtdb: RtdbAdapter, patch: CommandStatusPatch): Promise<void> {
  const values: Record<string, unknown> = {
    status: patch.status,
    updatedAt: patch.updatedAt,
  };
  if (patch.rejectionReason !== undefined) values.rejectionReason = patch.rejectionReason;
  if (patch.confirmedAt !== undefined) values.confirmedAt = patch.confirmedAt;
  await rtdb.update(commandNode(patch.id), values);

  if (patch.status === "REQUESTED" || patch.status === "ACCEPTED") {
    await updateActiveCommandStatus(rtdb, patch.ahuId, patch.id, patch.status);
  } else {
    await clearActiveCommand(rtdb, patch.ahuId, patch.id);
  }
}
