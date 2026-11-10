export const dynamic = "force-dynamic";

/**
 * Push ingestion is RETIRED. Devices report through the OWNER Firebase tree
 * (devices/{id}); the app's sampler mirrors them into this database. There is
 * no push endpoint anymore — the pre-shared device tokens live in the owner
 * project's deviceOwners/{id} and are never accepted here.
 */
export async function POST(): Promise<Response> {
  return Response.json(
    {
      error:
        "Telemetry push ingestion is retired. Devices report via the owner Firebase devices/{id} tree; this API no longer accepts pushes.",
    },
    { status: 410 },
  );
}
