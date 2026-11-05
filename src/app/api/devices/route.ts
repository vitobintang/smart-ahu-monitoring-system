import { randomHex, randomId } from "@/lib/ids";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ahus, devices } from "@/db/schema";
import type { DataSource } from "@/db/schema";
import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { refreshAhuStatus } from "@/lib/engine";
import { simulationTick } from "@/lib/workers";

export const dynamic = "force-dynamic";

/** FR-21 device provisioning — Admin only (issues device authentication tokens). */
export async function GET() {
  try {
    await requireAuth("manageUsers");
    const rows = await db.select({ id: devices.id, ahuId: devices.ahuId, label: devices.label, sourceType: devices.sourceType, enabled: devices.enabled, createdAt: devices.createdAt }).from(devices).orderBy(desc(devices.createdAt));
    const ahuRows = await db.select({ id: ahus.id, name: ahus.name }).from(ahus);
    return Response.json({
      devices: rows,
      ahus: ahuRows,
      physicalControlUnlocked: false,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAuth("manageUsers", { mutating: true });
    const ip = await getClientIp();
    const body = (await req.json()) as {
      ahuId?: string;
      label?: string;
      sourceType?: DataSource;
      deviceId?: string;
      enabled?: boolean;
    };

    // revoke / re-enable an existing provisioned device
    if (body.deviceId) {
      const existing = (await db.select().from(devices).where(eq(devices.id, body.deviceId)).limit(1))[0];
      if (!existing) return Response.json({ error: "Device not found" }, { status: 404 });
      const nextEnabled = Boolean(body.enabled);
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${existing.ahuId}, 0))`);
        await tx.update(devices).set({ enabled: nextEnabled }).where(eq(devices.id, existing.id));
        await writeAudit({
          userId: actor.user.id,
          userEmail: actor.user.email,
          action: "DEVICE_UPDATED",
          entity: `device:${existing.id}`,
          ipAddress: ip,
          details: { from: existing.enabled, to: nextEnabled, ahuId: existing.ahuId },
        }, tx);
      });

      // Immediately reflect enable/disable state in AHU status without waiting
      // for the background monitor/simulation interval.
      if (nextEnabled && existing.sourceType === "SIMULATION" && process.env.SIMULATION_ENABLED !== "false") {
        await simulationTick();
      }
      await refreshAhuStatus(existing.ahuId);

      return Response.json({
        ok: true,
        device: {
          id: existing.id,
          ahuId: existing.ahuId,
          label: existing.label,
          sourceType: existing.sourceType,
          enabled: nextEnabled,
          createdAt: existing.createdAt,
        },
      });
    }

    const ahuId = body.ahuId;
    if (!ahuId) return Response.json({ error: "ahuId is required" }, { status: 400 });
    const ahu = (await db.select({ id: ahus.id }).from(ahus).where(eq(ahus.id, ahuId)).limit(1))[0];
    if (!ahu) return Response.json({ error: `AHU ${ahuId} is not registered` }, { status: 404 });
    const sourceType: DataSource = body.sourceType === "PHYSICAL" ? "PHYSICAL" : "SIMULATION";

    const id = randomId();
    const token = `${sourceType === "PHYSICAL" ? "phy" : "sim"}_${ahuId.toLowerCase()}_${randomHex(24)}`;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ahuId}, 0))`);
      await tx.insert(devices).values({
        id,
        ahuId,
        label: (body.label ?? `${ahuId} ${sourceType.toLowerCase()} device`).slice(0, 120),
        token,
        sourceType,
        enabled: true,
      });

      await writeAudit({
        userId: actor.user.id,
        userEmail: actor.user.email,
        action: "DEVICE_PROVISIONED",
        entity: `device:${id}`,
        ipAddress: ip,
        details: { ahuId, sourceType, label: body.label ?? null },
      }, tx);
    });

    if (sourceType === "SIMULATION" && process.env.SIMULATION_ENABLED !== "false") {
      await simulationTick();
    }
    await refreshAhuStatus(ahuId);

    return Response.json({ ok: true, device: { id, ahuId, token, sourceType, label: body.label ?? null } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(err);
  }
}