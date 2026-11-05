import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ahus, sensorThresholds } from "@/db/schema";
import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { getAhuDetail, getSeries } from "@/lib/queries";
import { PARAM_KEYS, PARAM_MAP, type ParamKey } from "@/lib/domain";
import { normalizeRotation, resolveAhuPlacement, validatePlatformPlacement } from "@/lib/facility-layout";
import { getActiveFloorplan } from "@/lib/floorplan-store";
import { maybePulseWorkers } from "@/lib/workers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** FR-05 AHU detail + FR-08 live chart series. */
export async function GET(req: Request, ctx: Ctx) {
  try {
    await requireAuth("view");
    await maybePulseWorkers();
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const windowMin = Number(url.searchParams.get("window") ?? 15);
    const win = [5, 15, 30].includes(windowMin) ? windowMin : 15;
    const [detail, series] = await Promise.all([getAhuDetail(id), getSeries(id, win)]);
    if (!detail) return Response.json({ error: `AHU ${id} not found` }, { status: 404 });
    return Response.json({ ...detail, windowMin: win, series, serverTime: new Date().toISOString() });
  } catch (err) {
    return jsonError(err);
  }
}

/** FR-19 configuration management (Admin + Engineering) + 3D floor-map repositioning. */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const body = (await req.json()) as {
      name?: string;
      location?: string;
      commTimeoutSec?: number;
      hasHeater?: boolean;
      installedSensors?: string[];
      mapX?: number;
      mapZ?: number;
      mapRotation?: number;
      thresholds?: Array<{
        parameter: string;
        enabled?: boolean;
        lowLimit?: number | null;
        highLimit?: number | null;
        delaySec?: number;
        priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
        trendEnabled?: boolean;
      }>;
    };

    const hasConfigFields =
      body.name !== undefined ||
      body.location !== undefined ||
      body.commTimeoutSec !== undefined ||
      body.hasHeater !== undefined ||
      body.installedSensors !== undefined ||
      (Array.isArray(body.thresholds) && body.thresholds.length > 0);

    const actor = await requireAuth(hasConfigFields ? "configure" : "control", { mutating: true });
    const { id } = await ctx.params;
    const before = (await db.select().from(ahus).where(eq(ahus.id, id)).limit(1))[0];
    if (!before) return Response.json({ error: `AHU ${id} not found` }, { status: 404 });

    const patch: Record<string, unknown> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (typeof body.mapX === "number" && Number.isFinite(body.mapX) && typeof body.mapZ === "number" && Number.isFinite(body.mapZ)) {
      const [allRows, floorplan] = await Promise.all([
        db.select().from(ahus).orderBy(asc(ahus.id)),
        getActiveFloorplan(),
      ]);
      const existingPlacements: Array<{ id: string; x: number; z: number; rotation?: number }> = [];
      for (const r of allRows) {
        const p = resolveAhuPlacement(r, existingPlacements, floorplan.vertices);
        existingPlacements.push({ id: r.id, x: p.x, z: p.z, rotation: p.rotation });
      }
      const requestedRot =
        typeof body.mapRotation === "number" && Number.isFinite(body.mapRotation)
          ? normalizeRotation(body.mapRotation)
          : undefined;
      const check = validatePlatformPlacement(
        body.mapX,
        body.mapZ,
        existingPlacements,
        id,
        requestedRot,
        floorplan.vertices,
      );
      if (!check.valid || !check.zone) {
        return Response.json(
          { error: check.reason ?? "Invalid 3D floor platform position." },
          { status: 400 },
        );
      }
      patch.mapX = check.snappedX;
      patch.mapZ = check.snappedZ;
      patch.mapRotation = check.rotation;
      patch.mapZone = check.zone.label;
      changes.mapPlacement = {
        from: { mapX: before.mapX, mapZ: before.mapZ, mapRotation: before.mapRotation, mapZone: before.mapZone },
        to: { mapX: check.snappedX, mapZ: check.snappedZ, mapRotation: check.rotation, mapZone: check.zone.label },
      };
    } else if (typeof body.mapRotation === "number" && Number.isFinite(body.mapRotation)) {
      const nextRot = normalizeRotation(body.mapRotation);
      patch.mapRotation = nextRot;
      changes.mapRotation = { from: before.mapRotation, to: nextRot };
    }

    if (typeof body.name === "string" && body.name.trim()) {
      patch.name = body.name.trim().slice(0, 120);
      changes.name = { from: before.name, to: patch.name };
    }
    if (typeof body.location === "string" && body.location.trim()) {
      patch.location = body.location.trim().slice(0, 160);
      changes.location = { from: before.location, to: patch.location };
    }
    if (body.commTimeoutSec !== undefined) {
      const v = Number(body.commTimeoutSec);
      if (!Number.isFinite(v) || v < 5 || v > 3600)
        return Response.json({ error: "commTimeoutSec must be between 5 and 3600 seconds" }, { status: 400 });
      patch.commTimeoutSec = Math.round(v);
      changes.commTimeoutSec = { from: before.commTimeoutSec, to: patch.commTimeoutSec };
    }
    if (body.hasHeater !== undefined) {
      patch.hasHeater = Boolean(body.hasHeater);
      changes.hasHeater = { from: before.hasHeater, to: patch.hasHeater };
    }
    if (Array.isArray(body.installedSensors)) {
      const clean = body.installedSensors.filter((s): s is ParamKey => PARAM_KEYS.includes(s as ParamKey));
      if (clean.length === 0)
        return Response.json({ error: "At least one sensor must remain installed" }, { status: 400 });
      if (patch.hasHeater === false || (patch.hasHeater === undefined && !before.hasHeater)) {
        const idx = clean.indexOf("heaterOutput");
        if (idx >= 0) clean.splice(idx, 1);
      }
      patch.installedSensors = clean;
      changes.installedSensors = { from: before.installedSensors, to: clean };
    }

    if (Object.keys(patch).length > 0) {
      await db.update(ahus).set(patch).where(eq(ahus.id, id));
      const g = globalThis as typeof globalThis & { __ahuOverviewCache?: Map<string, unknown> };
      g.__ahuOverviewCache?.clear();
    }

    const thresholdChanges: unknown[] = [];
    for (const th of body.thresholds ?? []) {
      if (!PARAM_KEYS.includes(th.parameter as ParamKey)) continue;
      const existing = (
        await db
          .select()
          .from(sensorThresholds)
          .where(eq(sensorThresholds.id, `${id}:${th.parameter}`))
          .limit(1)
      )[0];
      const meta = PARAM_MAP[th.parameter as ParamKey];
      const next = {
        enabled: th.enabled ?? existing?.enabled ?? false,
        lowLimit: th.lowLimit === undefined ? (existing?.lowLimit ?? null) : th.lowLimit,
        highLimit: th.highLimit === undefined ? (existing?.highLimit ?? null) : th.highLimit,
        delaySec: th.delaySec === undefined ? (existing?.delaySec ?? 5) : Math.max(0, Math.min(600, Math.round(th.delaySec))),
        priority: th.priority ?? existing?.priority ?? "MEDIUM",
        trendEnabled: th.trendEnabled ?? existing?.trendEnabled ?? false,
      };
      if (next.lowLimit !== null && next.highLimit !== null && next.lowLimit >= next.highLimit) {
        return Response.json(
          { error: `${meta.label}: lower limit must be smaller than upper limit` },
          { status: 400 },
        );
      }
      if (existing) {
        const diff =
          existing.enabled !== next.enabled ||
          existing.lowLimit !== next.lowLimit ||
          existing.highLimit !== next.highLimit ||
          existing.delaySec !== next.delaySec ||
          existing.priority !== next.priority ||
          existing.trendEnabled !== next.trendEnabled;
        if (!diff) continue;
        thresholdChanges.push({ parameter: th.parameter, from: existing, to: next });
        await db.update(sensorThresholds).set(next).where(eq(sensorThresholds.id, existing.id));
      } else {
        await db.insert(sensorThresholds).values({
          id: `${id}:${th.parameter}`,
          ahuId: id,
          parameter: th.parameter,
          unit: meta.unit,
          label: meta.label,
          validMin: meta.validMin,
          validMax: meta.validMax,
          ...next,
        });
        thresholdChanges.push({ parameter: th.parameter, from: null, to: next });
      }
    }

    if (Object.keys(changes).length === 0 && thresholdChanges.length === 0) {
      return Response.json({ ok: true, changed: false });
    }

    const ip = await getClientIp();
    await writeAudit({
      userId: actor.user.id,
      userEmail: actor.user.email,
      action: "CONFIG_CHANGED",
      entity: `ahu:${id}`,
      ipAddress: ip,
      details: { ahu: changes, thresholds: thresholdChanges },
    });
    return Response.json({ ok: true, changed: true, changes, thresholdChanges });
  } catch (err) {
    return jsonError(err);
  }
}