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

type AuthPhase = "idle" | "verifying" | "redirecting" | "google";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-[17px] w-[17px] flex-none">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v2.98h3.86c2.26-2.09 3.56-5.17 3.56-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-2.98c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.07A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.31A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.58.37-2.31V6.62H1.29A12 12 0 0 0 0 12c0 1.93.46 3.77 1.29 5.38l3.98-3.07Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.98 3.07c.95-2.85 3.6-4.94 6.73-4.94Z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleSetupHint, setGoogleSetupHint] = useState(false);
  const [phase, setPhase] = useState<AuthPhase>("idle");

  const busy = phase !== "idle";
  const supabaseCallbackHint = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/auth/v1/callback`
    : "https://<PROJECT_REF>.supabase.co/auth/v1/callback";

  useEffect(() => {
    router.prefetch("/dashboard");
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const errCode = params.get("error");
    const detail = params.get("detail");
    const emailParam = params.get("email");
    if (!errCode) return;

    if (errCode === "google_not_configured") {
      setGoogleSetupHint(true);
      setError("Google Sign-In is ready in the app — enable the Google provider in Firebase Authentication to activate it.");
    } else if (errCode === "unregistered_google") {
      setError(
        emailParam
          ? `No operator account is registered for ${emailParam}. Ask an Administrator to add this email in Admin → Users first — once registered, both Password and Google Sign-In open the same account.`
          : "This Google account is not registered yet. Ask an Administrator to add your Gmail address in Admin → Users first.",
      );
    } else if (errCode === "google_cancelled") {
      setError("Google sign-in was cancelled.");
    } else if (errCode === "supabase_not_configured") {
      setError("Firebase environment variables are missing.");
    } else {
      setError(detail ? `Google sign-in failed: ${detail}` : "Google sign-in could not be completed. Please try again.");
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setPhase("verifying");
    setError(null);
    setGoogleSetupHint(false);
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

  async function signInWithGoogle() {
    if (busy) return;
    setError(null);
    setGoogleSetupHint(false);
    setPhase("google");
    try {
      // 1) Popup sign-in with the Firebase client SDK (loaded lazily).
      const { signInWithGooglePopup } = await import("@/lib/firebase/client");
      const { idToken } = await signInWithGooglePopup();

      // 2) Server verifies the token, resolves the RTDB account, mints the session.
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        code?: string;
        relinkToken?: string;
      };

      // 3) Google opened a NEW Firebase uid for an already-registered email:
      //    exchange the one-time relink token and publish the original account's session.
      if (res.ok && data.relinkToken) {
        const { relinkWithCustomToken } = await import("@/lib/firebase/client");
        const relinkIdToken = await relinkWithCustomToken(data.relinkToken);
        const done = await fetch("/api/auth/google", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ relinkTokenIdToken: relinkIdToken }),
        });
        if (!done.ok) {
          const errData = (await done.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error ?? "Google Sign-In failed");
        }
      } else if (!res.ok) {
        if (data.code === "email_not_registered") {
          setError(data.error ?? "This Google account is not registered yet.");
          setPhase("idle");
          return;
        }
        throw new Error(data.error ?? "Google Sign-In failed");
      }

      setPhase("redirecting");
      window.location.replace("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google Sign-In failed";
      if (/cancelled|canceled|popup.closed|ERR_POPUP/i.test(message)) {
        setError("Google Sign-In was cancelled.");
        setPhase("idle");
        return;
      }
      if (/unauthorized-domain/i.test(message)) {
        setGoogleSetupHint(true);
        setError("This domain is not yet authorized in Firebase Authentication settings.");
        setPhase("idle");
        return;
      }
      setError(message);
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
                  <span className="font-semibold text-white">Supabase Auth &amp; PostgreSQL</span> — unified identity
                  across Email/Username + Password and Google Sign-In
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
              Sign in with <strong className="font-semibold text-[#12294d]">Google (Gmail)</strong> or your{" "}
              <strong className="font-semibold text-[#12294d]">Email / Username</strong> &amp;{" "}
              <strong className="font-semibold text-[#12294d]">Password</strong>. Matching Gmail addresses automatically
              open the same account.
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

            {/* Google / Gmail Sign-In Button */}
            <div className="mt-4">
              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={busy}
                className={cx(
                  "flex w-full items-center justify-center gap-2.5 rounded-xl border border-[#cbd5e1] bg-white px-4 py-2.5 text-[13px] font-bold text-[#0f172a] shadow-[0_2px_8px_-2px_rgba(15,23,42,0.08)] transition",
                  busy
                    ? "cursor-not-allowed opacity-65"
                    : "hover:border-[#94a3b8] hover:bg-[#f8fafc] active:scale-[0.995]",
                )}
              >
                {phase === "google" ? (
                  <>
                    <Loader2 size={16} className="animate-spin text-[#2563eb]" />
                    Connecting to Google…
                  </>
                ) : (
                  <>
                    <GoogleMark />
                    Continue with Google
                  </>
                )}
              </button>
            </div>

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-[#e2e8f0]" />
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#64748b]">
                or email / username
              </span>
              <div className="h-px flex-1 bg-[#e2e8f0]" />
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
                <div
                  className={cx(
                    "rounded-xl border px-3.5 py-2.5 text-[12px] font-medium",
                    googleSetupHint
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-red-200 bg-red-50 text-red-700",
                  )}
                >
                  <p>{error}</p>
                  {googleSetupHint ? (
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] text-amber-800">
                      <li>
                        In Google Cloud Console → <strong>Credentials</strong>, create an OAuth 2.0 Client ID with
                        Authorized Redirect URI:{" "}
                        <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">
                          {supabaseCallbackHint}
                        </code>
                      </li>
                      <li>
                        In Supabase Dashboard → <strong>Authentication → Providers → Google</strong>, toggle{" "}
                        <strong>Enable Sign in with Google</strong> ON and paste the Client ID &amp; Secret.
                      </li>
                    </ol>
                  ) : null}
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
