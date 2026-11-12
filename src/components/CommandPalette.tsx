"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Activity,
  AlertTriangle,
  Building2,
  Box,
  FileText,
  Home,
  Search,
  Settings,
  Sliders,
  Wind,
  X,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const runCommand = (command: () => void) => {
    onOpenChange(false);
    command();
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/60 p-3 pt-[15vh] backdrop-blur-sm sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="animate-rise relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-[0_24px_70px_-16px_rgba(15,23,42,0.45)] backdrop-blur-xl">
        <Command className="flex flex-col">
          {/* Header Search Input */}
          <div className="flex items-center border-b border-slate-100 px-4 py-3">
            <Search className="mr-3 h-4 w-4 shrink-0 text-slate-400" />
            <Command.Input
              autoFocus
              placeholder="Type a command, jump to device, or search pages..."
              className="flex h-6 w-full rounded-md bg-transparent text-[13.5px] font-medium text-slate-900 placeholder:text-slate-400 outline-none"
            />
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="ml-2 grid h-6 w-6 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* List Options */}
          <Command.List className="max-h-80 overflow-y-auto p-2 text-slate-700 outline-none">
            <Command.Empty className="py-8 text-center text-[12.5px] text-slate-400">
              No matching HVAC systems, pages, or actions found.
            </Command.Empty>

            {/* Navigation Group */}
            <Command.Group
              heading="Navigation"
              className="overflow-hidden p-1 text-slate-900 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-400"
            >
              <Command.Item
                onSelect={() => runCommand(() => router.push("/dashboard"))}
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <Home className="h-4 w-4 text-blue-600" />
                <span>Executive Dashboard</span>
                <span className="ml-auto text-[10.5px] font-normal text-slate-400">Overview</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => router.push("/room3d"))}
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <Box className="h-4 w-4 text-indigo-600" />
                <span>3D Room Digital Twin</span>
                <span className="ml-auto text-[10.5px] font-normal text-slate-400">Live 3D</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => router.push("/devices"))}
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <Building2 className="h-4 w-4 text-sky-600" />
                <span>Fleet Devices &amp; AHU Units</span>
                <span className="ml-auto text-[10.5px] font-normal text-slate-400">7 Units</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => router.push("/alarms"))}
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                <span>Alarms &amp; Fault Center</span>
                <span className="ml-auto text-[10.5px] font-normal text-slate-400">Monitor</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => router.push("/reports"))}
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <FileText className="h-4 w-4 text-emerald-600" />
                <span>Reports &amp; Data Logger</span>
                <span className="ml-auto text-[10.5px] font-normal text-slate-400">Export</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => router.push("/simulator"))}
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <Sliders className="h-4 w-4 text-amber-600" />
                <span>Virtual HVAC Simulator</span>
                <span className="ml-auto text-[10.5px] font-normal text-slate-400">Diagnostics</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => router.push("/config"))}
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <Settings className="h-4 w-4 text-slate-600" />
                <span>System Configuration &amp; Gateways</span>
                <span className="ml-auto text-[10.5px] font-normal text-slate-400">Admin</span>
              </Command.Item>
            </Command.Group>

            {/* Devices Instant Jump */}
            <Command.Group
              heading="Devices & AHU Units"
              className="overflow-hidden p-1 text-slate-900 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-400"
            >
              <Command.Item
                onSelect={() => runCommand(() => router.push("/devices/LOC-AHU-01"))}
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <Wind className="h-4 w-4 text-emerald-600" />
                <span>LOC-AHU-01 · Plant Room Main AHU</span>
                <span className="ml-auto rounded-md bg-emerald-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-700">RUNNING</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => router.push("/devices/LOC-DAK-01"))}
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <Wind className="h-4 w-4 text-slate-500" />
                <span>LOC-DAK-01 · Meeting Room Ceiling Cassette</span>
                <span className="ml-auto text-[10.5px] font-mono text-slate-400">AC_DAK</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => router.push("/devices/LOC-SPLIT-01"))}
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <Wind className="h-4 w-4 text-slate-500" />
                <span>LOC-SPLIT-01 · Office A Split Wall</span>
                <span className="ml-auto text-[10.5px] font-mono text-slate-400">AC_SPLIT</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => router.push("/devices/LOC-SPLIT-02"))}
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <Wind className="h-4 w-4 text-slate-500" />
                <span>LOC-SPLIT-02 · Office B Split Wall</span>
                <span className="ml-auto text-[10.5px] font-mono text-slate-400">AC_SPLIT</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => router.push("/devices/LOC-STAND-01"))}
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <Wind className="h-4 w-4 text-slate-500" />
                <span>LOC-STAND-01 · Server Hall Floor Standing</span>
                <span className="ml-auto text-[10.5px] font-mono text-slate-400">AC_STAND</span>
              </Command.Item>
            </Command.Group>

            {/* Quick Actions */}
            <Command.Group
              heading="Quick Actions"
              className="overflow-hidden p-1 text-slate-900 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-400"
            >
              <Command.Item
                onSelect={() =>
                  runCommand(() => {
                    toast.success("Telemetry synchronized", {
                      description: "Polled latest sensor values from BACnet gateway.",
                    });
                  })
                }
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <Activity className="h-4 w-4 text-blue-600" />
                <span>Sync Real-Time Telemetry</span>
                <span className="ml-auto text-[10.5px] font-mono text-slate-400">Instant</span>
              </Command.Item>

              <Command.Item
                onSelect={() =>
                  runCommand(async () => {
                    try {
                      const res = await fetch("/api/alarms", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ all: true }),
                      }).then((r) => r.json());
                      toast.success("All alarms acknowledged", {
                        description: `Acknowledged ${res.count ?? "all"} active alarms.`,
                      });
                    } catch {
                      router.push("/alarms");
                    }
                  })
                }
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>Acknowledge All Active Alarms</span>
                <span className="ml-auto text-[10.5px] font-mono text-slate-400">⌘A</span>
              </Command.Item>

              <Command.Item
                onSelect={() =>
                  runCommand(async () => {
                    try {
                      const res = await fetch("/api/alarms", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ allAcknowledged: true }),
                      }).then((r) => r.json());
                      toast.success("Acknowledged alarms cleared", {
                        description: `Cleared ${res.clearedCount ?? 0} alarms from history.`,
                      });
                    } catch {
                      router.push("/alarms");
                    }
                  })
                }
                className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold outline-none transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
              >
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                <span>Clear All Acknowledged Alarms</span>
                <span className="ml-auto text-[10.5px] font-mono text-slate-400">Clear</span>
              </Command.Item>
            </Command.Group>
          </Command.List>

          {/* Footer keyboard hints */}
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-400">
            <span>Navigation: ↑ ↓ to navigate</span>
            <span>Select: ↵ Enter · Close: Esc</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
