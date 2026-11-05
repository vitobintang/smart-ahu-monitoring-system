"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Cpu, Eye, EyeOff, Fan, Lock, ShieldCheck, UserCheck, Wifi } from "lucide-react";
import { api } from "@/lib/client";
import { BUILD_NOTES, BUILD_STAMP } from "@/lib/build";
import { Btn, Field, cx, inputClass } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier: identifier.trim(),
          password,
        }),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-x-clip px-3 py-5 sm:p-6">
      <div className="pointer-events-none absolute inset-0">
        <Image src="/ahu/sky-hero.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-white/35 via-[#eef3fa]/70 to-[#e9eef7]" />
      </div>

      <div className="panel panel-raised relative grid w-full max-w-5xl overflow-hidden rounded-2xl lg:grid-cols-[1.05fr_1fr]">
        {/* Mobile & Tablet compact brand banner */}
        <div
          className="flex items-center gap-3 px-5 py-4 lg:hidden"
          style={{ backgroundImage: "linear-gradient(135deg,#0c2144 0%,#0a1c38 100%)" }}
        >
          <span className="relative h-10 w-10 flex-none overflow-hidden rounded-xl shadow-[0_8px_20px_-6px_rgba(47,123,246,0.9)] ring-1 ring-white/25">
            <Image src="/ahu/logo.png" alt="Smart Monitoring AHU logo" fill sizes="40px" className="object-cover" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-bold tracking-[-0.01em] text-white">Smart Monitoring AHU</h1>
            <p className="truncate text-[10px] uppercase tracking-[0.12em] text-[#8ea3c0]">
              Air Handling Unit Monitoring &amp; Control
            </p>
          </div>
        </div>

        {/* Desktop overview panel */}
        <div
          className="relative hidden flex-col justify-between p-8 lg:flex"
          style={{ backgroundImage: "linear-gradient(160deg,#0c2144 0%,#0a1c38 60%,#081428 100%)" }}
        >
          <div>
            <div className="flex items-center gap-3">
              <span className="relative h-11 w-11 overflow-hidden rounded-xl shadow-[0_8px_20px_-6px_rgba(47,123,246,0.9)] ring-1 ring-white/25">
                <Image src="/ahu/logo.png" alt="Smart Monitoring AHU logo" fill sizes="44px" className="object-cover" />
              </span>
              <div>
                <h1 className="text-[17px] font-bold tracking-[-0.01em] text-white">Smart Monitoring AHU</h1>
                <p className="text-[10.5px] uppercase tracking-[0.14em] text-[#8ea3c0]">
                  Air Handling Unit Monitoring &amp; Control System
                </p>
              </div>
            </div>

            <p className="mt-8 max-w-sm text-[13px] leading-relaxed text-[#b9c8dd]">
              Continuous supervision of <span className="font-mono font-semibold text-[#7dd3fc]">7 AHU</span> units
              across 12 process parameters, with threshold &amp; fault alarming, trend proximity estimation,
              transactional data logging and role-based control.
            </p>

            <ul className="mt-8 space-y-3 text-[12px] text-[#93a7c4]">
              <li className="flex items-start gap-2.5">
                <Fan size={14} className="mt-0.5 flex-none text-[#4ade80]" />
                <span>
                  <span className="font-semibold text-white">FR-03 … FR-08</span> — live dashboard, equipment
                  visualisation and 5 / 15 / 30-minute streaming charts
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <ShieldCheck size={14} className="mt-0.5 flex-none text-[#7dd3fc]" />
                <span>
                  <span className="font-semibold text-white">FR-25 … FR-27</span> — START / STOP / AUTO-MANUAL /
                  setpoint with single active command queue, 60 s TTL and interlocks
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <Wifi size={14} className="mt-0.5 flex-none text-[#c4b5fd]" />
                <span>
                  <span className="font-semibold text-white">FR-24 / NFR-05</span> — Supabase Cloud database with 5 s
                  polling
                </span>
              </li>
            </ul>
          </div>

          <div className="mt-8 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-100/90">
            <strong className="font-semibold text-amber-50">NFR-09:</strong> the web STOP command is a normal
            operational stop and is not an emergency stop (E-STOP). Local hardware interlocks stay active whenever
            server connectivity is lost.
          </div>
        </div>

        <div className="bg-white p-5 sm:p-8">
          <h2 className="flex items-center gap-2 text-[16px] font-bold tracking-[-0.01em] text-slate-800">
            <Lock size={16} className="text-[#1d6ef2]" />
            Sign in to Smart Monitoring AHU
          </h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
            Sign in using your <strong>Email</strong> or <strong>Username</strong> and <strong>Password</strong> across
            all roles (<span className="font-medium text-slate-700">Admin, Engineering, Operator, Viewer</span>). Rate
            limited to 10 attempts per 15 minutes per IP (NFR-02).
          </p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {(["Admin", "Engineering", "Operator", "Viewer"] as const).map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-1 rounded-full border border-[#dbe7fb] bg-[#f4f8ff] px-2.5 py-0.5 text-[10.5px] font-semibold text-[#1d6ef2]"
              >
                <UserCheck size={11} /> {r}
              </span>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label="Email or Username" hint="Enter your account email or assigned username">
              <input
                className={inputClass}
                type="text"
                autoComplete="username"
                spellCheck={false}
                placeholder="e.g. vizobintang or admin@example.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </Field>

            <Field label="Password">
              <div className="relative">
                <input
                  className={cx(inputClass, "pr-10")}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition hover:text-slate-700"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </Field>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-600">
                {error}
              </div>
            ) : null}

            <Btn type="submit" variant="primary" disabled={busy} className="w-full py-2.5">
              {busy ? "Signing in…" : "Sign in"}
            </Btn>
          </form>

          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600">
            <p className="flex items-start gap-2">
              <Cpu size={14} className="mt-0.5 flex-none text-[#1d6ef2]" />
              <span>
                <strong className="font-semibold text-slate-800">AHU Monitoring Modules:</strong> Bearer tokens are used
                only to register new AHU telemetry gateway modules in <span className="font-mono">/admin?tab=devices</span>.
              </span>
            </p>
          </div>

          <div className="mt-5">
            <p className="text-[10px] leading-relaxed text-slate-400">
              build <span className="font-mono font-semibold text-slate-500">{BUILD_STAMP}</span> — {BUILD_NOTES}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
