import { randomHex, randomId } from "@/lib/ids";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ahus, devices } from "@/db/schema";
import type { DataSource } from "@/db/schema";
import { getClientIp, jsonError, requireAuth, writeAudit } from "@/lib/auth";
import { readAuthoritativeSource, reconcileAhuSourceTransition, refreshAhuStatus } from "@/lib/engine";
import { resetSimulatorUnit, simulationTick } from "@/lib/workers";

export const dynamic = "force-dynamic";

/** FR-21 device provisioning — Admin only (issues device authentication tokens). */
export async function GET() {
  try {
    await requireAuth("manageUsers");
    const rows = await db
      .select({
        id: devices.id,
        ahuId: devices.ahuId,
        label: devices.label,
        sourceType: devices.sourceType,
        enabled: devices.enabled,
        createdAt: devices.createdAt,
      })
      .from(devices)
      .orderBy(asc(devices.ahuId), asc(devices.createdAt));
    const ahuRows = await db.select({ id: ahus.id, name: ahus.name }).from(ahus).orderBy(asc(ahus.id));
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
      let prevSource: "PHYSICAL" | "SIMULATION" | null = null;
      let nextSource: "PHYSICAL" | "SIMULATION" | null = null;
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${existing.ahuId}, 0))`);
        prevSource = await readAuthoritativeSource(tx, existing.ahuId);
        await tx.update(devices).set({ enabled: nextEnabled }).where(eq(devices.id, existing.id));
        nextSource = await readAuthoritativeSource(tx, existing.ahuId);
        const reconciled = await reconcileAhuSourceTransition(tx, {
          ahuId: existing.ahuId,
          prevSource,
          nextSource,
          userId: actor.user.id,
          userEmail: actor.user.email,
          ipAddress: ip,
        });
        await writeAudit(
          {
            userId: actor.user.id,
            userEmail: actor.user.email,
            action: "DEVICE_UPDATED",
            entity: `device:${existing.id}`,
            ipAddress: ip,
            details: {
              from: existing.enabled,
              to: nextEnabled,
              ahuId: existing.ahuId,
              prevSource,
              nextSource,
              ...reconciled,
            },
          },
          tx,
        );
      });

      if (prevSource === "SIMULATION" && nextSource !== "SIMULATION") {
        resetSimulatorUnit(existing.ahuId);
      }

      if (nextSource === "SIMULATION" && process.env.SIMULATION_ENABLED !== "false") {
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

    // Prevent duplicate SIMULATION controllers on the same AHU unit
    if (sourceType === "SIMULATION") {
      const existingSim = await db
        .select({ id: devices.id, label: devices.label })
        .from(devices)
        .where(and(eq(devices.ahuId, ahuId), eq(devices.sourceType, "SIMULATION")))
        .limit(1);
      if (existingSim.length > 0) {
        return Response.json(
          {
            error: `${ahuId} already has a Simulation Controller ("${existingSim[0].label}"). Toggle the existing controller or choose PHYSICAL to connect a hardware gateway.`,
          },
          { status: 409 },
        );
      }
    }

    const cleanLabel = (
      body.label?.trim() ||
      (sourceType === "PHYSICAL" ? `${ahuId} Hardware Gateway` : `${ahuId} Simulation Controller`)
    ).slice(0, 120);

    const id = randomId();
    const token = `${sourceType === "PHYSICAL" ? "phy" : "sim"}_${ahuId.toLowerCase()}_${randomHex(24)}`;
    let prevSource: "PHYSICAL" | "SIMULATION" | null = null;
    let nextSource: "PHYSICAL" | "SIMULATION" | null = null;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ahuId}, 0))`);
      prevSource = await readAuthoritativeSource(tx, ahuId);
      await tx.insert(devices).values({
        id,
        ahuId,
        label: cleanLabel,
        token,
        sourceType,
        enabled: true,
      });
      nextSource = await readAuthoritativeSource(tx, ahuId);
      const reconciled = await reconcileAhuSourceTransition(tx, {
        ahuId,
        prevSource,
        nextSource,
        userId: actor.user.id,
        userEmail: actor.user.email,
        ipAddress: ip,
      });

      await writeAudit(
        {
          userId: actor.user.id,
          userEmail: actor.user.email,
          action: "DEVICE_PROVISIONED",
          entity: `device:${id}`,
          ipAddress: ip,
          details: {
            ahuId,
            sourceType,
            label: cleanLabel,
            prevSource,
            nextSource,
            ...reconciled,
          },
        },
        tx,
      );
    });

    if (prevSource === "SIMULATION" && nextSource !== "SIMULATION") {
      resetSimulatorUnit(ahuId);
    }

    if (nextSource === "SIMULATION" && process.env.SIMULATION_ENABLED !== "false") {
      await simulationTick();
    }
    await refreshAhuStatus(ahuId);

    return Response.json(
      { ok: true, device: { id, ahuId, token, sourceType, label: cleanLabel } },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const actor = await requireAuth("manageUsers", { mutating: true });
    const ip = await getClientIp();
    const url = new URL(req.url);
    const deviceId = url.searchParams.get("deviceId")?.trim();
    if (!deviceId) {
      return Response.json({ error: "deviceId is required" }, { status: 400 });
    }

    const [existing] = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
    if (!existing) {
      return Response.json({ error: "Module not found" }, { status: 404 });
    }

    let prevSource: "PHYSICAL" | "SIMULATION" | null = null;
    let nextSource: "PHYSICAL" | "SIMULATION" | null = null;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${existing.ahuId}, 0))`);
      prevSource = await readAuthoritativeSource(tx, existing.ahuId);
      await tx.delete(devices).where(eq(devices.id, existing.id));
      nextSource = await readAuthoritativeSource(tx, existing.ahuId);
      const reconciled = await reconcileAhuSourceTransition(tx, {
        ahuId: existing.ahuId,
        prevSource,
        nextSource,
        userId: actor.user.id,
        userEmail: actor.user.email,
        ipAddress: ip,
      });
      await writeAudit(
        {
          userId: actor.user.id,
          userEmail: actor.user.email,
          action: "DEVICE_REMOVED",
          entity: `device:${existing.id}`,
          ipAddress: ip,
          details: {
            ahuId: existing.ahuId,
            label: existing.label,
            sourceType: existing.sourceType,
            prevSource,
            nextSource,
            ...reconciled,
          },
        },
        tx,
      );
    });

    if (prevSource === "SIMULATION" && nextSource !== "SIMULATION") {
      resetSimulatorUnit(existing.ahuId);
    }
    if (nextSource === "SIMULATION" && process.env.SIMULATION_ENABLED !== "false") {
      await simulationTick();
    }
    await refreshAhuStatus(existing.ahuId);

    return Response.json({ ok: true, removedId: existing.id, ahuId: existing.ahuId });
  } catch (err) {
    return jsonError(err);
  }
}
