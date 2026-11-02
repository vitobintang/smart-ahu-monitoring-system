import type { UserRole } from "./ahu";

type SessionUser = {
  id: string;
  role: UserRole;
};

export async function buildSessionResponse(
  getUser: () => Promise<SessionUser | null>,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };

  try {
    const user = await getUser();

    if (user) {
      return Response.json({ user }, { status: 200, headers });
    }
  } catch {
    // Return a generic response without exposing error details.
  }

  return Response.json(
    { error: "Not authenticated" },
    { status: 401, headers },
  );
}