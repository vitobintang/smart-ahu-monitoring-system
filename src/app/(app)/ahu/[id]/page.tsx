import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/domain";
import AhuDetailView from "@/components/AhuDetailView";

export const dynamic = "force-dynamic";

export default async function AhuDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getSession();
  if (!ctx) redirect("/login");
  return (
    <AhuDetailView
      ahuId={id}
      canControl={can(ctx.user.role, "control")}
      physicalUnlocked={false}
    />
  );
}