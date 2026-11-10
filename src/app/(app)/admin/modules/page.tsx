import { HardDrive } from "lucide-react";

import DevicesTab from "../devices-tab";

/** FR-21 device module registry — its own page (split from Users). */
export default function ModulesPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-[20px] font-bold tracking-tight text-[#12294d] sm:text-[22px]">
          <HardDrive size={20} className="text-[#1d6ef2]" /> Device Modules
        </h1>
        <p className="text-xs text-[#475569]">
          Modules of the active device source · pause/resume telemetry ingestion per unit (FR-21)
        </p>
      </div>

      <DevicesTab />
    </div>
  );
}
