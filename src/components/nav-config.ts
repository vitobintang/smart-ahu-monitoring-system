import {
  Bell,
  Building2,
  ClipboardList,
  Database,
  FileText,
  Home,
  Settings,
  TrendingUp,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import type { SessionUser } from "@/lib/client";
import { can } from "@/lib/domain";

type Activity2 = Parameters<typeof can>[1];

export interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  activity: Activity2;
  badge?: "alarms";
}

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: Home, activity: "view" },
  { href: "/devices", label: "Devices", icon: Building2, activity: "view" },
  { href: "/alarms", label: "Alarms", icon: Bell, activity: "view", badge: "alarms" },
  { href: "/trends", label: "Trend Analysis", icon: TrendingUp, activity: "view" },
  { href: "/reports", label: "Reports & Data Logger", icon: FileText, activity: "view" },
  { href: "/energy", label: "Energy Management", icon: Zap, activity: "view" },
  { href: "/maintenance", label: "Maintenance", icon: Wrench, activity: "view" },
  { href: "/admin?tab=devices", label: "Modules", icon: Database, activity: "manageUsers" },
  { href: "/admin?tab=users", label: "Users", icon: Users, activity: "manageUsers" },
  { href: "/config", label: "Configurations", icon: Settings, activity: "configure" },
  { href: "/audit", label: "Audit Logs", icon: ClipboardList, activity: "viewAudit" },
];

export interface Feed {
  alarms: { id: string; ahuId: string; parameter: string; priority: string; message: string; triggeredAt: string; acknowledged: boolean }[];
  trends: { id: string; ahuId: string; parameter: string; estimatedMin: number; direction: string; createdAt: string }[];
  commands: { id: string; ahuId: string; commandType: string; status: string; expiresAt: string }[];
}

export function isActive(item: NavItem, pathname: string | null, search: URLSearchParams | null): boolean {
  const [path, query] = item.href.split("?");
  if (path === "/devices") return Boolean(pathname?.startsWith("/devices"));
  if (pathname !== path) return false;
  const want = new URLSearchParams(query ?? "");
  for (const [k, v] of want.entries()) {
    if ((search?.get(k) ?? (k === "tab" && path === "/reports" ? "summary" : k === "tab" ? "users" : null)) !== v) return false;
  }
  if (path === "/reports" && !want.has("tab") && search?.get("tab") === "logger") return false;
  if (path === "/admin" && !want.has("tab") && (search?.get("tab") ?? "users") !== "users") return false;
  return true;
}

export function rolePermissionsSummary(role: SessionUser["role"]): string[] {
  if (role === "Admin") return ["Monitoring & Reports", "AHU Control", "Thresholds & Config", "Users & Modules"];
  if (role === "Engineering") return ["Monitoring & Reports", "AHU Control", "Thresholds & Config", "Audit Logs"];
  if (role === "Operator") return ["Monitoring & Reports", "AHU Control", "Alarm & Trend Ack"];
  return ["Read-Only Monitoring & Reports"];
}
