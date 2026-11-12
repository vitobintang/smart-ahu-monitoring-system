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
        <div className="space-y-4 animate-pulse">
          <div className="h-8 w-64 rounded-xl bg-slate-200/80" />
          <div className="h-[360px] w-full rounded-2xl bg-slate-900/80 border border-slate-200/80" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 rounded-2xl border border-slate-200/80 bg-white/90 p-4" />
            ))}
          </div>
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
