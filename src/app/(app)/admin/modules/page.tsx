import { Cpu, HardDrive } from "lucide-react";
import DevicesTab from "../devices-tab";

/** FR-21 device module registry — its own page (split from Users). */
export default function ModulesPage() {
  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="flex items-center gap-3 text-[22px] font-extrabold tracking-[-0.02em] text-[#12294d] sm:text-[24px]">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[#2563eb] to-[#1d4ed8] text-white shadow-[0_12px_24px_-8px_rgba(37,99,235,0.7)]">
            <HardDrive size={19} />
          </span>
          Device Modules &amp; Ingestion Gateways
        </h1>
        <p className="mt-1.5 text-[12.5px] font-medium text-slate-500 max-w-3xl leading-relaxed">
          Provisioned edge IoT drivers, telemetry ingestion gateway status, and hardware stream control per unit.
          <span className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-blue-700">
            FR-21 · Active Device Fleet
          </span>
        </p>
      </div>

      <DevicesTab />
    </div>
  );
}
