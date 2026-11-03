/**
 * Node.js-only process crash guards.
 *
 * Kept in its own module and imported lazily from `instrumentation.ts` so the
 * Edge build never has to see `process.on` (which is unavailable there).
 *
 * Node >= 15 terminates the process on an *unhandled* promise rejection. For a
 * continuously running AHU monitoring daemon — background simulation, monitor
 * loop, retry-queue draining — that would silently take the whole web service
 * offline, so every stray async failure is logged and contained instead.
 */
export function installProcessGuards(): boolean {
  const g = globalThis as typeof globalThis & { __ahuGuardsInstalled?: boolean };
  if (g.__ahuGuardsInstalled) return false;
  g.__ahuGuardsInstalled = true;

  process.on("unhandledRejection", (reason) => {
    console.error(
      "[AHU][guard] unhandled rejection contained:",
      reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
    );
  });

  process.on("uncaughtException", (err) => {
    console.error("[AHU][guard] uncaught exception contained:", err?.stack ?? err?.message ?? String(err));
  });

  process.on("warning", (warning) => {
    if (warning?.name !== "ExperimentalWarning") {
      console.warn("[AHU][guard] warning:", warning?.message);
    }
  });

  return true;
}