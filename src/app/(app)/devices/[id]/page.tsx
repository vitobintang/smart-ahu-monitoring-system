"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { can } from "@/lib/domain";
import { useSessionUser } from "@/components/AppShell";
import AhuDetailView from "@/components/AhuDetailView";
import { Spinner } from "@/components/ui";

export default function AhuDetailPage() {
  const params = useParams<{ id: string }>();
  const user = useSessionUser();
  const id = typeof params?.id === "string" ? params.id : "";

  // Suspense boundary is required because AhuDetailView reads useSearchParams
  // for context-aware back navigation (?from=/dashboard or ?from=/devices).
  return (
    <Suspense
      fallback={
        <div className="panel rounded-2xl p-6">
          <Spinner />
        </div>
      }
    >
      <AhuDetailView
        ahuId={id}
        canControl={user ? can(user.role, "control") : false}
        physicalUnlocked={false}
      />
    </Suspense>
  );
}
