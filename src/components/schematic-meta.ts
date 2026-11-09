import type { ParamKey } from "@/lib/domain";

export type Stage = "ok" | "warn" | "alarm" | "off" | "missing";

export const TONE: Record<Stage, { stroke: string; fill: string; text: string; dot: string; pill: string }> = {
  ok: { stroke: "#10b981", fill: "rgba(16,185,129,0.13)", text: "#6ee7b7", dot: "bg-emerald-500", pill: "border-emerald-300 bg-emerald-50/90 text-emerald-900" },
  warn: { stroke: "#f59e0b", fill: "rgba(245,158,11,0.15)", text: "#fcd34d", dot: "bg-amber-500", pill: "border-amber-300 bg-amber-50/90 text-amber-900" },
  alarm: { stroke: "#ef4444", fill: "rgba(239,68,68,0.17)", text: "#fca5a5", dot: "bg-red-500", pill: "border-red-300 bg-red-50/90 text-red-900" },
  missing: { stroke: "#475569", fill: "rgba(51,65,85,0.14)", text: "#64748b", dot: "bg-slate-400", pill: "border-[#cbd5e1] bg-[#f8fafc] text-[#475569]" },
  off: { stroke: "#64748b", fill: "rgba(71,85,105,0.1)", text: "#94a3b8", dot: "bg-slate-500", pill: "border-[#cbd5e1] bg-white text-[#1e293b]" },
};

export interface StageDef {
  key: ParamKey;
  label: string;
  sub: string;
  state: Stage;
  param: ParamKey;
}
