"use client";

import { useParams } from "next/navigation";
import { can } from "@/lib/domain";
import { useSessionUser } from "@/components/AppShell";
import AhuDetailView from "@/components/AhuDetailView";

export default function AhuDetailPage() {
  const params = useParams<{ id: string }>();
  const user = useSessionUser();
  const id = typeof params?.id === "string" ? params.id : "";

  return (
    <AhuDetailView
      ahuId={id}
      canControl={user ? can(user.role, "control") : false}
      physicalUnlocked={false}
    />
  );
}
