"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  Activity,
  AtSign,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Database,
  FileText,
  Home,
  KeyRound,
  LogOut,
  Mail,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  TrendingUp,
  UserCog,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { api, fmtDateTime, timeAgo, type SessionUser, type SyncInfo } from "@/lib/client";
import { can } from "@/lib/domain";
import { BUILD_STAMP } from "@/lib/build";
import { Btn, Field, cx, inputClass } from "@/components/ui";

const SessionUserContext = createContext<SessionUser | null>(null);

export function useSessionUser(): SessionUser | null {
  return useContext(SessionUserContext);
}

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
  { href: "/admin?tab=devices", label: "AHU Modules", icon: Database, activity: "manageUsers" },
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

function rolePermissionsSummary(role: SessionUser["role"]): string[] {
  if (role === "Admin") return ["Monitoring & Reports", "AHU Control", "Thresholds & Config", "Users & AHU Modules"];
  if (role === "Engineering") return ["Monitoring & Reports", "AHU Control", "Thresholds & Config", "Audit Logs"];
  if (role === "Operator") return ["Monitoring & Reports", "AHU Control", "Alarm & Trend Ack"];
  return ["Read-Only Monitoring & Reports"];
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
  const [currentUser, setCurrentUser] = useState<SessionUser>(user);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; text: string; tone: string }[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const [liveSync, setLiveSync] = useState<SyncInfo | null>(sync);

  // Account settings form state
  const [editFullName, setEditFullName] = useState(user.fullName ?? "");
  const [editUsername, setEditUsername] = useState(user.username ?? "");
  const [editPassword, setEditPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setCurrentUser(user);
    setEditFullName(user.fullName ?? "");
    setEditUsername(user.username ?? "");
  }, [user]);

  // Close mobile drawer automatically on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, search]);

  // Lock body scroll when mobile drawer or account modal is open
  useEffect(() => {
    if (!mobileOpen && !settingsOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen, settingsOpen]);

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
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void load();
    }, 5000);
    const syncId = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const s = await api<SyncInfo>("/api/sync");
        if (alive) setLiveSync(s);
      } catch {
        /* ignore */
      }
    }, 20000);
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
      if (!el.closest?.("[data-profile]")) setProfileOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        setBellOpen(false);
        setProfileOpen(false);
        setSettingsOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      window.removeEventListener("keydown", onKeyDown);
    };
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

  function openAccountSettings() {
    setProfileOpen(false);
    setProfileNotice(null);
    setProfileError(null);
    setEditFullName(currentUser.fullName ?? "");
    setEditUsername(currentUser.username ?? "");
    setEditPassword("");
    setSettingsOpen(true);
  }

  async function saveAccountSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileNotice(null);
    setProfileError(null);
    try {
      const payload: Record<string, string> = {
        fullName: editFullName,
      };
      if (editUsername.trim()) {
        payload.username = editUsername.trim();
      }
      if (editPassword) {
        payload.newPassword = editPassword;
      }
      const res = await api<{ ok: boolean; passwordUpdated: boolean; user: SessionUser }>("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setCurrentUser(res.user);
      setEditUsername(res.user.username ?? "");
      setEditFullName(res.user.fullName ?? "");
      setEditPassword("");
      setProfileNotice(
        res.passwordUpdated
          ? "Account details and password updated."
          : "Account profile saved.",
      );
      router.refresh();
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not update profile");
    } finally {
      setSavingProfile(false);
    }
  }

  async function logout() {
    setProfileOpen(false);
    setSettingsOpen(false);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const items = NAV.filter((n) => can(currentUser.role, n.activity));
  const unackedAlarms = (feed?.alarms ?? []).filter((a) => !a.acknowledged).length;
  const displayName =
    currentUser.fullName?.trim() ||
    currentUser.username ||
    currentUser.email.split("@")[0];
  const initials = (
    (currentUser.fullName || currentUser.username || currentUser.email).trim().slice(0, 2) ||
    currentUser.role.slice(0, 2)
  ).toUpperCase();

  return (
    <div className="min-h-dvh overflow-x-clip">
      {/* Mobile / Tablet tap-outside backdrop to close sidebar */}
      {mobileOpen ? (
        <div
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
          className="no-print fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[2px] transition-opacity lg:hidden"
        />
      ) : null}

      <aside
        aria-label="Primary navigation"
        className={cx(
          "no-print fixed inset-y-0 left-0 z-50 flex w-[min(85vw,280px)] flex-none flex-col overflow-hidden bg-[#0b1f3f] shadow-2xl lg:z-40 lg:w-[280px] lg:shadow-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "transition-transform duration-200 ease-out lg:translate-x-0",
        )}
      >
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[46%]">
          <Image src="/ahu/plant-room.jpg" alt="" fill sizes="280px" className="object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0b1f3f] via-[#0b1f3f]/45 to-[#081428]/88" />
        </div>

        <div className="flex items-center justify-between gap-2 px-5 pb-5 pt-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative h-10 w-10 flex-none overflow-hidden rounded-xl shadow-[0_10px_24px_-8px_rgba(59,130,246,0.95)] ring-1 ring-white/25 sm:h-11 sm:w-11">
              <Image src="/ahu/logo.png" alt="Smart Monitoring AHU logo" fill sizes="44px" className="object-cover" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[14.5px] font-bold tracking-[-0.01em] text-white sm:text-[15px]">
                Smart Monitoring AHU
              </span>
              <span className="mt-0.5 block text-[10px] leading-snug text-[#7e93b8]">
                Air Handling Unit Monitoring
                <br />
                &amp; Control System
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="grid h-9 w-9 flex-none place-items-center rounded-xl border border-white/15 bg-white/10 text-white transition hover:bg-white/20 lg:hidden"
          >
            <X size={17} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto overscroll-contain px-3.5 pb-4">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item, pathname, search);
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cx(
                  "group flex items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium transition-all duration-150 sm:px-4 sm:py-3",
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
          <div className="rounded-2xl border border-white/15 bg-white/8 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-md">
            <p className="text-[12px] font-bold text-white">System Status</p>
            <p className="mt-1.5 flex items-center gap-2 text-[11.5px] font-semibold text-white">
              <span className="h-2.5 w-2.5 rounded-full bg-[#22c55e] shadow-[0_0_10px_rgba(34,197,94,0.9)]" />
              {liveSync?.mode === "LOCAL" ? "Local PostgreSQL Active" : "Supabase Cloud Connected"}
            </p>
            <div className="mt-2 space-y-1 text-[10.5px] text-[#9db1d0]">
              <p className="flex items-center gap-2">
                <Database size={12} className="text-[#22c55e]" />
                {`Supabase · ${liveSync?.pollingIntervalSec ?? 5}s poll`}
              </p>
              <p className="flex items-center gap-2" suppressHydrationWarning>
                <CheckCircle2 size={12} className="text-[#22c55e]" />
                Last sync: {liveSync?.lastSuccessAt ? (mounted ? timeAgo(liveSync.lastSuccessAt) : "just now") : "—"}
              </p>
            </div>
          </div>
          <p className="mt-2.5 px-1 text-[10px] leading-relaxed text-[#64799c]">
            Smart Monitoring AHU · v1.2.0 · build <span className="font-mono text-[#8ea3c4]">{BUILD_STAMP}</span>
          </p>
        </div>
      </aside>

      <div className="relative flex min-h-dvh flex-col overflow-x-clip lg:pl-[280px]">
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[440px]">
          <Image
            src="/ahu/mountains.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-[center_46%] saturate-[1.1] contrast-[1.02]"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#eef3fa]/32 to-[#eef3fa]" />
        </div>

        <header
          className={cx(
            "no-print sticky top-0 z-30 transition-all duration-200",
            scrolled
              ? "border-b border-[#e6ecf5] bg-white/90 shadow-[0_4px_18px_-12px_rgba(16,24,40,0.25)] backdrop-blur-xl"
              : "border-b border-transparent bg-white/55 backdrop-blur-md lg:bg-transparent lg:backdrop-blur-none",
          )}
        >
          <div className="flex h-[60px] items-center gap-2 px-3 sm:h-[64px] sm:gap-3 sm:px-6">
            <button
              type="button"
              className="grid h-10 w-10 flex-none place-items-center rounded-xl text-slate-600 transition hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation"
              aria-expanded={mobileOpen}
            >
              <Menu size={20} />
            </button>

            <Link href="/dashboard" className="flex min-w-0 items-center gap-2 md:hidden">
              <span className="relative h-8 w-8 flex-none overflow-hidden rounded-lg ring-1 ring-slate-200">
                <Image src="/ahu/logo.png" alt="" fill sizes="32px" className="object-cover" />
              </span>
              <span className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-[#12294d]">
                Smart AHU
              </span>
            </Link>

            <label className="relative hidden max-w-xl flex-1 md:block">
              <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full rounded-full border border-[#e6ecf5] bg-[#f1f5fb]/90 py-2 pl-10 pr-16 text-[12.5px] text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#bfdbfe] focus:bg-white focus:ring-4 focus:ring-[#2563eb]/10"
                placeholder="Search AHU units, alarms, reports…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const q = e.currentTarget.value.trim().toUpperCase();
                    if (/^AHU-0[1-7]$/.test(q)) router.push(`/ahu/${q}`);
                    else if (q) router.push("/ahu");
                  }
                }}
              />
              <kbd className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-[#e6ecf5] bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                ↵
              </kbd>
            </label>

            <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
              {/* Notifications popover */}
              <div className="relative" data-bell>
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    setBellOpen((v) => !v);
                  }}
                  className="relative grid h-10 w-10 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-[#2563eb]"
                  aria-label="Notifications"
                  aria-expanded={bellOpen}
                >
                  <Bell size={19} />
                  {unackedAlarms > 0 ? (
                    <span className="absolute right-1 top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-[#ef4444] px-1 font-mono text-[9.5px] font-bold text-white ring-2 ring-white">
                      {unackedAlarms}
                    </span>
                  ) : null}
                </button>
                {bellOpen ? (
                  <div className="panel panel-raised animate-rise fixed inset-x-3 top-[64px] z-50 overflow-hidden rounded-2xl bg-white/96 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96">
                    <div className="flex items-center justify-between border-b border-[#eef2f7] px-4 py-2.5">
                      <p className="eyebrow">Notifications · FR-18</p>
                      <span className="font-mono text-[10px] font-semibold text-emerald-600">live</span>
                    </div>
                    <div className="max-h-[min(65dvh,22rem)] space-y-1.5 overflow-y-auto p-2.5">
                      {(feed?.alarms ?? []).slice(0, 8).map((a) => (
                        <Link
                          key={a.id}
                          href="/alarms"
                          onClick={() => setBellOpen(false)}
                          className="block rounded-xl border border-[#eef2f7] bg-[#f8fafc] p-2.5 transition hover:border-red-200"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-bold text-slate-800">{a.ahuId}</span>
                            <span className="font-mono text-[9px] uppercase tracking-wider text-slate-400">{a.priority}</span>
                            <span className="ml-auto text-[10px] text-slate-400">{timeAgo(a.triggeredAt)}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">{a.message}</p>
                        </Link>
                      ))}
                      {(feed?.trends ?? []).slice(0, 5).map((t) => (
                        <Link
                          key={t.id}
                          href="/trends"
                          onClick={() => setBellOpen(false)}
                          className="block rounded-xl border border-[#ede9fe] bg-[#f5f3ff] p-2.5 transition hover:border-[#c4b5fd]"
                        >
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

              {/* Account Profile dropdown (does NOT immediately log out!) */}
              <div className="relative" data-profile>
                <button
                  type="button"
                  onClick={() => {
                    setBellOpen(false);
                    setProfileOpen((v) => !v);
                  }}
                  aria-expanded={profileOpen}
                  aria-haspopup="menu"
                  className="ml-0.5 flex items-center gap-2 rounded-full border border-transparent py-1 pl-1 pr-2 transition hover:border-[#e4eaf3] hover:bg-white/80 sm:gap-2.5 sm:pr-2.5"
                  title="Account profile & settings"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#0b1f3f] text-[11.5px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(11,31,63,0.7)] sm:h-10 sm:w-10 sm:text-[12px]">
                    {initials}
                  </span>
                  <span className="hidden text-left leading-tight sm:block">
                    <span className="block max-w-[9.5rem] truncate text-[13px] font-bold text-slate-800">
                      {displayName}
                    </span>
                    <span className="block text-[10.5px] font-medium text-slate-500">
                      {currentUser.username ? `@${currentUser.username} · ` : ""}
                      {currentUser.role}
                    </span>
                  </span>
                  <ChevronDown
                    size={15}
                    className={cx("text-slate-400 transition-transform", profileOpen && "rotate-180")}
                  />
                </button>

                {profileOpen ? (
                  <div
                    role="menu"
                    className="panel panel-raised animate-rise fixed inset-x-3 top-[64px] z-50 overflow-hidden rounded-2xl bg-white/98 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80"
                  >
                    <div className="border-b border-[#eef2f7] bg-gradient-to-br from-[#f8fafd] to-[#eef4ff] p-4">
                      <div className="flex items-start gap-3">
                        <span className="grid h-11 w-11 flex-none place-items-center rounded-2xl bg-[#0b1f3f] text-[13px] font-bold text-white shadow-sm">
                          {initials}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-bold text-[#12294d]">{displayName}</p>
                          {currentUser.username ? (
                            <p className="truncate font-mono text-[11px] font-semibold text-[#1d6ef2]">
                              @{currentUser.username}
                            </p>
                          ) : null}
                          <p className="mt-0.5 truncate text-[11px] text-slate-500">{currentUser.email}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-md bg-[#2563eb] px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-white">
                          <ShieldCheck size={11} /> {currentUser.role}
                        </span>
                        <span className="text-[10.5px] text-slate-400">
                          Joined {fmtDateTime(currentUser.createdAt).split(",")[0]}
                        </span>
                      </div>
                    </div>

                    <div className="border-b border-[#eef2f7] px-4 py-2.5">
                      <p className="eyebrow mb-1.5">Role permissions</p>
                      <div className="flex flex-wrap gap-1">
                        {rolePermissionsSummary(currentUser.role).map((perm) => (
                          <span
                            key={perm}
                            className="rounded-md border border-[#e4eaf3] bg-[#f8fafc] px-2 py-0.5 text-[10px] font-medium text-slate-600"
                          >
                            {perm}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="p-1.5">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={openAccountSettings}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12.5px] font-semibold text-slate-700 transition hover:bg-[#f1f5fb] hover:text-[#1d6ef2]"
                      >
                        <UserCog size={15} className="text-[#1d6ef2]" />
                        Profile &amp; Account Settings
                      </button>

                      {currentUser.role === "Admin" ? (
                        <Link
                          href="/admin?tab=users"
                          role="menuitem"
                          onClick={() => setProfileOpen(false)}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12.5px] font-semibold text-slate-700 transition hover:bg-[#f1f5fb] hover:text-[#1d6ef2]"
                        >
                          <Users size={15} className="text-slate-500" />
                          Manage Users &amp; AHU Modules
                        </Link>
                      ) : null}

                      <div className="my-1 border-t border-[#eef2f7]" />

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void logout()}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12.5px] font-semibold text-red-600 transition hover:bg-red-50"
                      >
                        <LogOut size={15} />
                        Sign out
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="relative min-w-0 flex-1 px-3.5 py-4 sm:px-6 sm:py-6 lg:px-7">
          <SessionUserContext.Provider value={currentUser}>{children}</SessionUserContext.Provider>
        </main>

        <footer className="no-print relative flex flex-col items-start justify-between gap-2 px-4 pb-5 pt-2 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:px-6">
          <span>© 2026 Smart Monitoring AHU. All rights reserved.</span>
          <span className="flex flex-wrap items-center gap-1.5">
            Safer Air <span className="text-slate-400">|</span> Smarter Buildings <span className="text-slate-400">|</span> A Cleaner Tomorrow
            <Image src="/ahu/leaf.png" alt="" width={26} height={26} className="h-[18px] w-[18px] object-contain mix-blend-multiply" />
          </span>
        </footer>
      </div>

      {/* Portal-mounted Account Settings modal */}
      {settingsOpen && mounted
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Profile and account settings"
              onClick={(e) => {
                if (e.target === e.currentTarget) setSettingsOpen(false);
              }}
              className="no-print fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/55 p-2.5 backdrop-blur-xs sm:items-center sm:p-4"
            >
              <div className="animate-rise flex max-h-[calc(100dvh-1.25rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#dbe4f0] bg-white shadow-[0_24px_70px_-18px_rgba(15,23,42,0.45)] sm:max-h-[calc(100dvh-3rem)]">
                <header className="flex flex-none items-center justify-between gap-3 border-b border-[#e6ecf5] bg-[#f8fafd] px-4 py-3.5 sm:px-5">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-[#0b1f3f] text-xs font-bold text-white">
                      {initials}
                    </span>
                    <div>
                      <h3 className="text-[14px] font-bold text-[#12294d]">Profile &amp; Account Settings</h3>
                      <p className="text-[11px] text-slate-500">
                        Role: <span className="font-semibold text-[#1d6ef2]">{currentUser.role}</span>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                    aria-label="Close account settings"
                    className="grid h-9 w-9 flex-none place-items-center rounded-xl border border-[#dbe4f0] bg-white text-slate-500 transition hover:text-slate-800"
                  >
                    <X size={16} />
                  </button>
                </header>

                <form onSubmit={saveAccountSettings} className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
                  <div className="grid gap-2.5 rounded-xl border border-[#e6ecf5] bg-[#f8fafd] p-3 text-[11.5px] sm:grid-cols-2">
                    <div>
                      <p className="eyebrow flex items-center gap-1">
                        <Mail size={11} /> Account Email
                      </p>
                      <p className="mt-0.5 break-all font-mono font-semibold text-slate-700">{currentUser.email}</p>
                    </div>
                    <div>
                      <p className="eyebrow flex items-center gap-1">
                        <AtSign size={11} /> Current Username
                      </p>
                      <p className="mt-0.5 font-mono font-semibold text-[#1d6ef2]">
                        {currentUser.username ? `@${currentUser.username}` : "Not set"}
                      </p>
                    </div>
                  </div>

                  <Field label="Display name">
                    <input
                      className={inputClass}
                      maxLength={120}
                      value={editFullName}
                      onChange={(e) => setEditFullName(e.target.value)}
                      placeholder="e.g. Vito Bintang"
                    />
                  </Field>

                  <Field
                    label="Username"
                    hint="3–32 chars (letters, numbers, ., _, -) · can be used instead of email at login"
                  >
                    <input
                      className={cx(inputClass, "font-mono")}
                      maxLength={32}
                      value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value)}
                      placeholder="e.g. vizobintang"
                      required
                    />
                  </Field>

                  <Field
                    label="Change password (optional)"
                    hint="Leave blank to keep your current password · minimum 8 characters"
                  >
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      className={cx(inputClass, "font-mono")}
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      placeholder="New password (optional)"
                    />
                  </Field>

                  {profileError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {profileError}
                    </div>
                  ) : null}
                  {profileNotice ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                      {profileNotice}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#eef2f7] pt-3">
                    <Btn type="button" variant="danger" onClick={() => void logout()}>
                      <LogOut size={13} /> Sign out
                    </Btn>
                    <div className="flex items-center gap-2">
                      <Btn type="button" variant="default" onClick={() => setSettingsOpen(false)}>
                        Close
                      </Btn>
                      <Btn type="submit" variant="primary" disabled={savingProfile}>
                        <KeyRound size={13} /> {savingProfile ? "Saving…" : "Save changes"}
                      </Btn>
                    </div>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}

      <div className="no-print pointer-events-none fixed bottom-3 right-3 left-3 z-50 flex flex-col gap-2 sm:left-auto sm:bottom-4 sm:right-4 sm:w-96">
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
            <button type="button" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="flex-none text-slate-400 transition hover:text-slate-700">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
