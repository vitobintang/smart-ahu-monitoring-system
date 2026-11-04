"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Fan, KeyRound, Lock, ShieldCheck, Wifi } from "lucide-react";
import { api } from "@/lib/client";
import { BUILD_NOTES, BUILD_STAMP } from "@/lib/build";
import type { LoginMode } from "@/lib/role-auth";
import { Btn, Field, cx, inputClass } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(next: LoginMode) {
    setMode(next);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload =
        mode === "admin"
          ? { mode: "admin", email, password }
          : { mode: "token", token: token.trim() };
      await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0">
        <Image src="/ahu/sky-hero.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-white/35 via-[#eef3fa]/70 to-[#e9eef7]" />
      </div>

      <div className="panel panel-raised relative grid w-full max-w-5xl overflow-hidden rounded-2xl lg:grid-cols-[1.05fr_1fr]">
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
                <Fan size={14} className="mt-0.5 text-[#4ade80]" />
                <span>
                  <span className="font-semibold text-white">FR-03 … FR-08</span> — live dashboard, equipment
                  visualisation and 5 / 15 / 30-minute streaming charts
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <ShieldCheck size={14} className="mt-0.5 text-[#7dd3fc]" />
                <span>
                  <span className="font-semibold text-white">FR-25 … FR-27</span> — START / STOP / AUTO-MANUAL /
                  setpoint with single active command queue, 60 s TTL and interlocks
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <Wifi size={14} className="mt-0.5 text-[#c4b5fd]" />
                <span>
                  <span className="font-semibold text-white">FR-24 / NFR-05</span> — Supabase database with 5 s polling
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

        <div className="bg-white p-6 sm:p-8">
          <h2 className="flex items-center gap-2 text-[16px] font-bold tracking-[-0.01em] text-slate-800">
            {mode === "admin" ? (
              <Lock size={16} className="text-[#1d6ef2]" />
            ) : (
              <KeyRound size={16} className="text-[#1d6ef2]" />
            )}
            Sign in to Smart Monitoring AHU
          </h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
            Administrators sign in with email &amp; password · Other roles sign in using an admin-issued access token ·
            10 login attempts per 15 minutes (NFR-02).
          </p>

          <div
            role="tablist"
            aria-label="Sign-in method"
            className="mt-5 grid grid-cols-2 gap-1.5 rounded-xl border border-[#e4eaf3] bg-[#f4f7fc] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "admin"}
              onClick={() => switchMode("admin")}
              className={cx(
                "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-all",
                mode === "admin"
                  ? "bg-white text-[#1d6ef2] shadow-[0_2px_8px_-4px_rgba(16,24,40,0.2)] ring-1 ring-[#dbe7fb]"
                  : "text-slate-500 hover:text-slate-800",
              )}
            >
              <Lock size={13} />
              Admin (Email)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "token"}
              onClick={() => switchMode("token")}
              className={cx(
                "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-all",
                mode === "token"
                  ? "bg-white text-[#1d6ef2] shadow-[0_2px_8px_-4px_rgba(16,24,40,0.2)] ring-1 ring-[#dbe7fb]"
                  : "text-slate-500 hover:text-slate-800",
              )}
            >
              <KeyRound size={13} />
              Other Roles (Token)
            </button>
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            {mode === "admin" ? (
              <>
                <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                  <span className="font-semibold text-slate-800">Administrator sign-in:</span> enter your admin email
                  and password. No access token is required.
                </div>
                <Field label="Admin email address">
                  <input
                    className={inputClass}
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Password">
                  <input
                    className={inputClass}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Field>
              </>
            ) : (
              <>
                <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                  <span className="font-semibold text-slate-800">Engineering · Operator · Viewer:</span> enter the
                  one-time access token provided by your administrator. No email or password is required.
                </div>
                <Field
                  label="Access token"
                  hint="Issued by an administrator for Engineering, Operator, or Viewer access."
                >
                  <div className="relative">
                    <input
                      className={cx(inputClass, "pr-10 font-mono text-[12px]")}
                      type={showToken ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Paste 64-character access token…"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition hover:text-slate-700"
                      aria-label={showToken ? "Hide access token" : "Show access token"}
                    >
                      {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </Field>
              </>
            )}

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-600">{error}</div>
            ) : null}

            <Btn type="submit" variant="primary" disabled={busy} className="w-full py-2.5">
              {busy ? "Authenticating…" : mode === "admin" ? "Sign in as Admin" : "Sign in with Token"}
            </Btn>
          </form>

          <div className="mt-7">
            <p className="mt-4 text-[10px] leading-relaxed text-slate-400">
              build <span className="font-mono font-semibold text-slate-500">{BUILD_STAMP}</span> — {BUILD_NOTES}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
