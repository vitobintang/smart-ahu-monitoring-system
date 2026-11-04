import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession, safePublicUser } from "@/lib/auth";
import { getSyncStatus } from "@/lib/realtime";
import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getSession();
  if (!ctx) redirect("/login");
  const sync = await getSyncStatus().catch(() => null);
  return (
    <AppShell user={JSON.parse(JSON.stringify(safePublicUser(ctx.user)))} sync={JSON.parse(JSON.stringify(sync))}>
      {children}
    </AppShell>
  );
}