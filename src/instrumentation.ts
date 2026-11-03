/**
 * Next.js instrumentation hook — boots the AHU runtime services.
 *
 * Startup is deliberately NON-BLOCKING. `register()` installs process guards
 * and schedules the service boot, then returns immediately so the HTTP listener
 * (and readiness health checks) comes up without waiting for PostgreSQL.
 *
 * In container or cloud deployments PostgreSQL can become reachable after the
 * Node process starts, and a boot that awaited the database would delay or fail
 * health probes before the web server binds its port.
 *
 * Boot sequence (retried until the database answers):
 *  1. seed reference data — 7 AHUs, thresholds and devices
 *     (idempotent, so process restarts recover automatically)
 *  2. start the simulation engine (FR-28) and the monitor loop
 *     (communication-timeout alarms FR-14, command TTL FR-26, trend detection
 *     FR-16)
 */

const BOOT_DELAY_MS = Number(process.env.WORKER_BOOT_DELAY_MS ?? 2500);
const BOOT_MAX_ATTEMPTS = Number(process.env.WORKER_BOOT_ATTEMPTS ?? 12);
const BOOT_RETRY_MS = Number(process.env.WORKER_BOOT_RETRY_MS ?? 5000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bootServices() {
  for (let attempt = 1; attempt <= BOOT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const { seed } = await import("@/db/seed");
      await seed();

      const { startWorkers } = await import("@/lib/workers");
      startWorkers();

      console.log(`[AHU] services online (boot attempt ${attempt})`);
      return;
    } catch (err) {
      console.error(
        `[AHU] boot attempt ${attempt}/${BOOT_MAX_ATTEMPTS} failed:`,
        err instanceof Error ? err.message : err,
      );
      if (attempt < BOOT_MAX_ATTEMPTS) await sleep(BOOT_RETRY_MS);
    }
  }
  console.error("[AHU] services did not start; HTTP API remains available");
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const g = globalThis as typeof globalThis & { __ahuBootScheduled?: boolean };

  try {
    const { installProcessGuards } = await import("@/lib/process-guards");
    if (installProcessGuards()) console.log("[AHU] process crash guards installed");
  } catch (err) {
    console.error("[AHU] guard install failed:", err instanceof Error ? err.message : err);
  }

  if (!process.env.DATABASE_URL) return;

  // Schedule once per process; never await — startup must stay fast.
  if (!g.__ahuBootScheduled) {
    g.__ahuBootScheduled = true;
    const timer = setTimeout(() => {
      void bootServices().catch((err) =>
        console.error("[AHU] boot scheduler failed:", err instanceof Error ? err.message : err),
      );
    }, BOOT_DELAY_MS);
    timer.unref?.();
  }
}