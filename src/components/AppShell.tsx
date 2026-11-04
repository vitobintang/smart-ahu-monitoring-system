"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Activity,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Database,
  FileText,
  HelpCircle,
  Home,
  Menu,
  Search,
  Settings,
  TrendingUp,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { api, timeAgo, type SessionUser, type SyncInfo } from "@/lib/client";
import { can } from "@/lib/domain";
import { BUILD_STAMP } from "@/lib/build";
import { cx } from "@/components/ui";

type Activity2 = Parameters<typeof can>[1];

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  activity: Activity2;
  badge?: "alarms";
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: Home, activity: "view" },
  { href: "/ahu", label: "AHU Units", icon: Building2, activity: "view" },
  { href: "/alarms", label: "Alarms", icon: Bell, activity: "view", badge: "alarms" },
  { href: "/trends", label: "Trend Analysis", icon: TrendingUp, activity: "view" },
  { href: "/reports", label: "Reports & Data Logger", icon: FileText, activity: "view" },
  { href: "/energy", label: "Energy Management", icon: Zap, activity: "view" },
  { href: "/maintenance", label: "Maintenance", icon: Wrench, activity: "view" },
  { href: "/admin?tab=devices", label: "Devices", icon: Database, activity: "manageUsers" },
  { href: "/admin?tab=users", label: "Users", icon: Users, activity: "manageUsers" },
  { href: "/config", label: "Configurations", icon: Settings, activity: "configure" },
  { href: "/audit", label: "Audit Logs", icon: ClipboardList, activity: "viewAudit" },
];

interface Feed {
  alarms: { id: string; ahuId: string; parameter: string; priority: string; message: string; triggeredAt: string; acknowledged: boolean }[];
  trends: { id: string; ahuId: string; parameter: string; estimatedMin: number; direction: string; createdAt: string }[];
  commands: { id: string; ahuId: string; commandType: string; status: string; expiresAt: string }[];
}

function isActive(item: NavItem, pathname: string | null, search: URLSearchParams | null): boolean {
  const [path, query] = item.href.split("?");
  if (path === "/ahu") return Boolean(pathname?.startsWith("/ahu"));
  if (pathname !== path) return false;
  const want = new URLSearchParams(query ?? "");
  for (const [k, v] of want.entries()) {
    if ((search?.get(k) ?? (k === "tab" && path === "/reports" ? "summary" : k === "tab" ? "users" : null)) !== v) return false;
  }
  if (path === "/reports" && !want.has("tab") && search?.get("tab") === "logger") return false;
  if (path === "/admin" && !want.has("tab") && (search?.get("tab") ?? "users") !== "users") return false;
  return true;
}

export default function AppShell({
  user,
  sync,
  children,
}: {
  user: SessionUser;
  sync: SyncInfo | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; text: string; tone: string }[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const [liveSync, setLiveSync] = useState<SyncInfo | null>(sync);

  // FR-18 in-app notification broadcast to active web sessions.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api<Feed>("/api/notifications");
        if (!alive) return;
        setFeed(data);
        for (const a of data.alarms) {
          const key = `alarm:${a.id}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          if (a.priority === "CRITICAL" || a.priority === "HIGH") {
            pushToast(`${a.ahuId} · ${a.priority} · ${a.message}`, a.priority === "CRITICAL" ? "critical" : "warn");
          }
        }
        for (const t of data.trends) {
          const key = `trend:${t.id}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          pushToast(`Trend proximity · ${t.ahuId} ${t.parameter} ${t.direction} — breach within ${t.estimatedMin} min`, "info");
        }
      } catch {
        /* best-effort */
      }
    };
    void load();
    const id = setInterval(load, 5000);
    const syncId = setInterval(async () => {
      try {
        const s = await api<SyncInfo>("/api/sync");
        if (alive) setLiveSync(s);
      } catch {
        /* ignore */
      }
    }, 10000);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(syncId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest?.("[data-bell]")) setBellOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function pushToast(text: string, tone: string) {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((t) => [...t.slice(-1), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const items = NAV.filter((n) => can(user.role, n.activity));
  const unackedAlarms = (feed?.alarms ?? []).filter((a) => !a.acknowledged).length;

  return (
    <div className="min-h-screen overflow-x-clip">
      <aside
        className={cx(
          "no-print fixed inset-y-0 left-0 z-40 flex w-[280px] flex-none flex-col overflow-hidden bg-[#0b1f3f]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "transition-transform duration-200 lg:translate-x-0",
        )}
      >
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[46%]">
          <Image src="/ahu/plant-room.jpg" alt="" fill sizes="280px" className="object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0b1f3f] via-[#0b1f3f]/45 to-[#081428]/88" />
        </div>

        <div className="flex items-center gap-3 px-5 pb-6 pt-6">
          <span className="relative h-11 w-11 flex-none overflow-hidden rounded-xl shadow-[0_10px_24px_-8px_rgba(59,130,246,0.95)] ring-1 ring-white/25">
            <Image src="/ahu/logo.png" alt="Smart Monitoring AHU logo" fill sizes="44px" className="object-cover" />
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-bold tracking-[-0.01em] text-white">Smart Monitoring AHU</span>
            <span className="mt-0.5 block text-[10.5px] leading-snug text-[#7e93b8]">
              Air Handling Unit Monitoring
              <br />
              &amp; Control System
            </span>
          </span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-4 pb-4">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item, pathname, search);
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cx(
                  "group flex items-center gap-3.5 rounded-xl px-4 py-3 text-[13.5px] font-medium transition-all duration-150",
                  active
                    ? "bg-gradient-to-r from-[#2563eb] to-[#1d6ef2] text-white shadow-[0_10px_26px_-10px_rgba(37,99,235,1),inset_0_1px_0_rgba(255,255,255,0.25)]"
                    : "text-[#a7b7d2] hover:bg-white/6 hover:text-white",
                )}
              >
                <Icon size={18} className={cx("flex-none", active ? "text-white" : "text-[#7e93b8] group-hover:text-white")} />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge === "alarms" && unackedAlarms > 0 ? (
                  <span className="grid h-[19px] min-w-[19px] place-items-center rounded-full bg-[#ef4444] px-1 font-mono text-[10px] font-bold text-white shadow-[0_0_10px_rgba(239,68,68,0.8)]">
                    {unackedAlarms}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="relative flex-none px-4 pb-4">
          <div className="rounded-2xl border border-white/15 bg-white/8 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-md">
            <p className="text-[12.5px] font-bold text-white">System Status</p>
            <p className="mt-2 flex items-center gap-2 text-[12px] font-semibold text-white">
              <span className="h-2.5 w-2.5 rounded-full bg-[#22c55e] shadow-[0_0_10px_rgba(34,197,94,0.9)]" />
              {liveSync?.mode === "CLOUD" ? "Connected to Cloud" : "Local Polling Active"}
            </p>
            <div className="mt-2.5 space-y-1.5 text-[10.5px] text-[#9db1d0]">
              <p className="flex items-center gap-2">
                <Database size={12} className="text-[#22c55e]" />
                {`Supabase · ${liveSync?.pollingIntervalSec ?? 5}s poll`}
              </p>
              <p className="flex items-center gap-2">
                <CheckCircle2 size={12} className="text-[#22c55e]" />
                Last sync: {liveSync?.lastSuccessAt ? timeAgo(liveSync.lastSuccessAt) : "—"}
              </p>
              <p className="flex items-center gap-2">
                <CheckCircle2 size={12} className="text-[#22c55e]" />
                All Systems Operational
              </p>
            </div>
          </div>
          <p className="mt-3 px-1 text-[10.5px] leading-relaxed text-[#64799c]">
            Smart Monitoring AHU
            <br />
            v1.1.0 · build <span className="font-mono text-[#8ea3c4]">{BUILD_STAMP}</span>
          </p>
        </div>
      </aside>

      <div className="relative overflow-x-clip lg:pl-[280px]">
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[480px]">
          <Image
            src="/ahu/mountains.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-[center_46%] saturate-[1.1] contrast-[1.02]"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#eef3fa]/28 to-[#eef3fa]" />
        </div>

        <header
          className={cx(
            "no-print sticky top-0 z-30 transition-all duration-200",
            scrolled
              ? "border-b border-[#e6ecf5] bg-white/88 shadow-[0_4px_18px_-12px_rgba(16,24,40,0.25)] backdrop-blur-xl"
              : "border-b border-transparent bg-transparent",
          )}
        >
          <div className="flex h-[62px] items-center gap-3 px-4 sm:px-6">
            <button
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>

            <label className="relative hidden max-w-2xl flex-1 md:block">
              <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full rounded-full border border-[#e6ecf5] bg-[#f1f5fb] py-2.5 pl-10 pr-16 text-[12.5px] text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#bfdbfe] focus:bg-white focus:ring-4 focus:ring-[#2563eb]/10"
                placeholder="Search AHU units, alarms, reports…"
              />
              <kbd className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-[#e6ecf5] bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                ⌘K
              </kbd>
            </label>

            <div className="ml-auto flex items-center gap-1.5">
              <div className="relative" data-bell>
                <button
                  onClick={() => setBellOpen((v) => !v)}
                  className="relative rounded-full p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-[#2563eb]"
                  aria-label="Notifications"
                >
                  <Bell size={19} />
                  {unackedAlarms > 0 ? (
                    <span className="absolute right-1 top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-[#ef4444] px-1 font-mono text-[9.5px] font-bold text-white ring-2 ring-white">
                      {unackedAlarms}
                    </span>
                  ) : null}
                </button>
                {bellOpen ? (
                  <div className="panel panel-raised animate-rise absolute right-0 z-50 mt-2 w-[min(92vw,24rem)] overflow-hidden rounded-2xl">
                    <div className="flex items-center justify-between border-b border-[#eef2f7] px-4 py-2.5">
                      <p className="eyebrow">Notifications · FR-18</p>
                      <span className="font-mono text-[10px] text-emerald-600">live</span>
                    </div>
                    <div className="max-h-[22rem] space-y-1.5 overflow-y-auto p-2.5">
                      {(feed?.alarms ?? []).slice(0, 8).map((a) => (
                        <Link key={a.id} href="/alarms" className="block rounded-xl border border-[#eef2f7] bg-[#f8fafc] p-2.5 transition hover:border-red-200">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-bold text-slate-800">{a.ahuId}</span>
                            <span className="font-mono text-[9px] uppercase tracking-wider text-slate-400">{a.priority}</span>
                            <span className="ml-auto text-[10px] text-slate-400">{timeAgo(a.triggeredAt)}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">{a.message}</p>
                        </Link>
                      ))}
                      {(feed?.trends ?? []).slice(0, 5).map((t) => (
                        <Link key={t.id} href="/trends" className="block rounded-xl border border-[#ede9fe] bg-[#f5f3ff] p-2.5 transition hover:border-[#c4b5fd]">
                          <p className="text-[11px] font-semibold text-violet-700">
                            {t.ahuId} · {t.parameter} · {t.direction}
                          </p>
                          <p className="mt-0.5 text-[10.5px] text-violet-500">Projected breach within {t.estimatedMin} min</p>
                        </Link>
                      ))}
                      {(feed?.alarms ?? []).length === 0 && (feed?.trends ?? []).length === 0 ? (
                        <p className="py-8 text-center text-[11.5px] text-slate-400">No active notifications.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              <button className="rounded-full p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-[#2563eb]" title="Help & documentation">
                <HelpCircle size={19} />
              </button>

              <button
                onClick={logout}
                className="ml-1 flex items-center gap-3 rounded-full py-1.5 pl-1.5 pr-2.5 transition hover:bg-slate-100"
                title="Logout (FR-01)"
              >
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#0b1f3f] text-[12px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(11,31,63,0.7)]">
                  {user.email.slice(0, 2).toUpperCase()}
                </span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block max-w-[10rem] truncate text-[13px] font-bold text-slate-800">
                    {user.fullName ?? user.email.split("@")[0]}
                  </span>
                  <span className="block text-[10.5px] capitalize text-slate-400">{user.role.toLowerCase()}</span>
                </span>
                <ChevronDown size={15} className="text-slate-400" />
              </button>
            </div>
          </div>
        </header>

        <main className="relative min-w-0 px-4 py-6 sm:px-6 lg:px-7">{children}</main>

        <footer className="no-print relative flex flex-wrap items-center justify-between gap-2 px-6 pb-6 pt-2 text-[11px] text-slate-400">
          <span>© 2025 Smart Monitoring AHU. All rights reserved.</span>
          <span className="flex items-center gap-2">
            Safer Air <span className="text-slate-300">|</span> Smarter Buildings <span className="text-slate-300">|</span> A Cleaner Tomorrow
            <Image src="/ahu/leaf.png" alt="" width={26} height={26} className="h-[18px] w-[18px] object-contain mix-blend-multiply" />
          </span>
        </footer>
      </div>

      <div className="no-print pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,23rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "panel panel-raised animate-rise pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3 py-2.5",
              t.tone === "critical" ? "border-red-200 bg-red-50" : t.tone === "warn" ? "border-amber-200 bg-amber-50" : "border-violet-200 bg-violet-50",
            )}
          >
            <Activity size={14} className={cx("mt-0.5 flex-none", t.tone === "critical" ? "text-red-500" : t.tone === "warn" ? "text-amber-500" : "text-violet-500")} />
            <p className="flex-1 text-[11.5px] leading-snug text-slate-700">{t.text}</p>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="flex-none text-slate-400 transition hover:text-slate-700">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}