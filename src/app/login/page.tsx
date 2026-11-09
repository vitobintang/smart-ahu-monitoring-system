"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  AtSign,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Fan,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Wifi,
} from "lucide-react";
import { api } from "@/lib/client";
import { BUILD_NOTES, BUILD_STAMP } from "@/lib/build";
import { Btn, Field, cx, inputClass } from "@/components/ui";

type AuthPhase = "idle" | "verifying" | "redirecting";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<AuthPhase>("idle");

  const busy = phase !== "idle";

  useEffect(() => {
    router.prefetch("/dashboard");
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setPhase("verifying");
    setError(null);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier: identifier.trim(),
          password,
        }),
      });
      // Keep the button locked in "redirecting" until the browser lands on /dashboard
      // so it NEVER snaps back to clickable while the dashboard compiles/loads.
      setPhase("redirecting");
      window.location.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setPhase("idle");
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-between overflow-x-clip px-3 py-5 sm:px-6 sm:py-8">
      {/* Crisp full-bleed alpine mountain backdrop */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <Image
          src="/ahu/mountains.jpg"
          alt=""
          fill
          priority
          loading="eager"
          fetchPriority="high"
          sizes="100vw"
          className="object-cover object-[center_44%] saturate-[1.16] contrast-[1.04]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0c2144]/18 via-transparent to-[#dbe7f6]/58" />
        <div className="absolute inset-0 bg-[radial-gradient(900px_420px_at_50%_0%,rgba(255,255,255,0.28),transparent_70%)]" />
      </div>

      <div className="hidden sm:block" aria-hidden />

      {/* Main split sign-in card */}
      <div className="animate-rise relative z-10 my-auto grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/80 bg-white/82 shadow-[0_32px_80px_-20px_rgba(11,31,63,0.38),0_4px_16px_-4px_rgba(11,31,63,0.12)] ring-1 ring-[#12294d]/6 backdrop-blur-xl lg:grid-cols-[1.06fr_1fr]">
        {/* Mobile & Tablet compact brand header */}
        <div className="relative overflow-hidden px-5 py-4 lg:hidden" style={{ backgroundColor: "#0b1f3f" }}>
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-35">
            <Image
              src="/ahu/plant-room.jpg"
              alt=""
              fill
              sizes="100vw"
              loading="eager"
              fetchPriority="high"
              className="object-cover object-center"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0b1f3f] via-[#0b1f3f]/85 to-[#081428]/90" />
          </div>
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative h-10 w-10 flex-none overflow-hidden rounded-xl shadow-[0_8px_20px_-6px_rgba(47,123,246,0.95)] ring-1 ring-white/30">
                <Image src="/ahu/logo.png" alt="Smart Monitoring AHU logo" fill sizes="40px" loading="eager" className="object-cover" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-[15px] font-bold tracking-[-0.01em] text-white">Smart Monitoring AHU</h1>
                <p className="truncate text-[10px] uppercase tracking-[0.12em] text-[#9bb0cf]">
                  Air Handling Unit Monitoring &amp; Control
                </p>
              </div>
            </div>
            <span className="hidden items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm sm:inline-flex">
              <span className="h-2 w-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.9)]" />
              Live AHU Fleet
            </span>
          </div>
        </div>

        {/* Desktop left showcase column */}
        <div className="relative hidden flex-col justify-between overflow-hidden bg-[#0b1f3f] p-8 lg:flex xl:p-9">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%]">
            <Image
              src="/ahu/plant-room.jpg"
              alt=""
              fill
              sizes="520px"
              loading="eager"
              fetchPriority="high"
              className="object-cover object-center opacity-55"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-[#0b1f3f] via-[#0b1f3f]/72 to-[#071226]/92" />
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#2563eb]/25 blur-3xl"
          />

          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <span className="relative h-12 w-12 overflow-hidden rounded-2xl shadow-[0_10px_26px_-6px_rgba(47,123,246,0.95)] ring-1 ring-white/30">
                  <Image src="/ahu/logo.png" alt="Smart Monitoring AHU logo" fill sizes="48px" loading="eager" className="object-cover" />
                </span>
                <div>
                  <h1 className="text-[18px] font-bold tracking-[-0.015em] text-white">Smart Monitoring AHU</h1>
                  <p className="text-[10.5px] uppercase tracking-[0.14em] text-[#9db1d0]">
                    Air Handling Unit Monitoring &amp; Control
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-medium text-[#dbeafe] backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-[#22c55e] shadow-[0_0_10px_rgba(34,197,94,0.95)]" />
              Clean-Air Supervisory Telemetry · Live 5s Cloud Sync
            </div>

            <p className="mt-5 max-w-md text-[13.5px] leading-relaxed text-[#d1def0]">
              Continuous supervision of <span className="font-mono font-bold text-[#7dd3fc]">7 AHU</span> units across{" "}
              <span className="font-mono font-bold text-[#7dd3fc]">12</span> process parameters, with threshold &amp;
              fault alarming, trend proximity estimation, transactional data logging, and role-based control.
            </p>

            <ul className="mt-6 space-y-3 text-[12px] text-[#b8cae3]">
              <li className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/6 px-3.5 py-2.5 backdrop-blur-xs">
                <Fan size={15} className="mt-0.5 flex-none text-[#4ade80]" />
                <span>
                  <span className="font-semibold text-white">FR-03 … FR-08</span> — live fleet dashboard, interactive
                  AHU elevation &amp; 5 / 15 / 30-minute streaming charts
                </span>
              </li>
              <li className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/6 px-3.5 py-2.5 backdrop-blur-xs">
                <ShieldCheck size={15} className="mt-0.5 flex-none text-[#7dd3fc]" />
                <span>
                  <span className="font-semibold text-white">FR-25 … FR-27</span> — START / STOP / AUTO-MANUAL /
                  setpoint with single active command queue, 60 s TTL &amp; interlocks
                </span>
              </li>
              <li className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/6 px-3.5 py-2.5 backdrop-blur-xs">
                <Wifi size={15} className="mt-0.5 flex-none text-[#c4b5fd]" />
                <span>
                  <span className="font-semibold text-white">Firebase Auth &amp; Realtime Database</span> — unified
                  identity across Email/Username + Password
                </span>
              </li>
            </ul>
          </div>

          <div className="relative mt-7 rounded-2xl border border-amber-300/30 bg-amber-400/12 p-3.5 text-[11px] leading-relaxed text-amber-50 backdrop-blur-md">
            <strong className="font-semibold text-amber-200">NFR-09 Safety Notice:</strong> the web STOP command is a
            normal operational stop and is not an emergency stop (E-STOP). Local hardware interlocks stay active
            whenever server connectivity is lost.
          </div>
        </div>

        {/* Right sign-in panel */}
        <div className="flex flex-col justify-between bg-white/92 p-5 sm:p-8 xl:p-9">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#dbe7fb] bg-[#f2f7ff] px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-[#1d6ef2]">
              <Sparkles size={11} /> Secure Operator Portal
            </div>

            <h2 className="mt-3 flex items-center gap-2 text-[19px] font-bold tracking-[-0.015em] text-[#12294d] sm:text-[21px]">
              Welcome back
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#475569]">
              Sign in with your <strong className="font-semibold text-[#12294d]">Email / Username</strong> &amp;{" "}
              <strong className="font-semibold text-[#12294d]">Password</strong>.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {(["Admin", "Engineering", "Operator"] as const).map((r) => (
                <span
                  key={r}
                  className="inline-flex items-center gap-1 rounded-full border border-[#d6e4fb] bg-[#f5f9ff] px-2.5 py-0.5 text-[10.5px] font-semibold text-[#1d6ef2]"
                >
                  <UserCheck size={11} /> {r}
                </span>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-3.5">
              <Field label="Email or Username" hint="Use either your registered email address or @username">
                <div className="relative">
                  <AtSign
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b]"
                  />
                  <input
                    className={cx(inputClass, "py-2.5 pl-9")}
                    type="text"
                    autoComplete="username"
                    spellCheck={false}
                    disabled={busy}
                    placeholder="e.g. vizobintang or vizobintang@gmail.com"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                  />
                </div>
              </Field>

              <Field label="Password">
                <div className="relative">
                  <Lock
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b]"
                  />
                  <input
                    className={cx(inputClass, "py-2.5 pl-9 pr-10")}
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    disabled={busy}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#64748b] transition hover:bg-slate-100 hover:text-[#0f172a] disabled:opacity-50"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </Field>

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] font-medium text-red-700">
                  <p>{error}</p>
                </div>
              ) : null}

              <Btn
                type="submit"
                variant="primary"
                disabled={busy}
                className={cx(
                  "w-full py-2.5 text-[13px] transition-all",
                  phase === "redirecting"
                    ? "bg-gradient-to-r from-[#059669] to-[#10b981] shadow-[0_12px_26px_-10px_rgba(16,185,129,0.9)]"
                    : "bg-gradient-to-r from-[#2563eb] to-[#1d6ef2] shadow-[0_12px_26px_-10px_rgba(37,99,235,0.9)] hover:from-[#1d4ed8] hover:to-[#155bd4]",
                )}
              >
                {phase === "verifying" ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Verifying credentials…
                  </>
                ) : phase === "redirecting" ? (
                  <>
                    <CheckCircle2 size={15} />
                    Signed in! Opening Dashboard…
                    <Loader2 size={14} className="animate-spin" />
                  </>
                ) : (
                  <>
                    Sign in to Dashboard <ArrowRight size={14} />
                  </>
                )}
              </Btn>
            </form>
          </div>

          <div className="mt-5 space-y-2.5">
            <div className="rounded-xl border border-[#e2eaf4] bg-[#f7faff] px-3.5 py-2.5 text-[11px] leading-relaxed text-[#334155]">
              <p className="flex items-start gap-2">
                <Cpu size={14} className="mt-0.5 flex-none text-[#1d6ef2]" />
                <span>
                  <strong className="font-semibold text-[#12294d]">AHU Monitoring Modules:</strong> Bearer tokens are
                  used exclusively to connect AHU telemetry gateways in{" "}
                  <span className="font-mono font-semibold text-[#1d6ef2]">/admin?tab=devices</span>.
                </span>
              </p>
            </div>

            <p className="text-[10px] leading-relaxed text-[#64748b]">
              build <span className="font-mono font-semibold text-[#334155]">{BUILD_STAMP}</span> — {BUILD_NOTES}
            </p>
          </div>
        </div>
      </div>

      {/* Subtle alpine footer caption matching AppShell */}
      <p className="relative z-10 mt-4 flex flex-wrap items-center justify-center gap-1.5 rounded-full border border-white/65 bg-white/72 px-4 py-1.5 text-[11px] font-medium text-[#334155] shadow-xs backdrop-blur-md">
        <span>Safer Air</span>
        <span className="text-[#94a3b8]">|</span>
        <span>Smarter Buildings</span>
        <span className="text-[#94a3b8]">|</span>
        <span>A Cleaner Tomorrow</span>
        <Image
          src="/ahu/leaf.png"
          alt=""
          width={22}
          height={22}
          className="h-[16px] w-[16px] object-contain mix-blend-multiply"
        />
      </p>
    </div>
  );
}
