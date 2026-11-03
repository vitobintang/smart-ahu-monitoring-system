"use client";

import React, { useEffect, useRef, useState } from "react";

type Role = "Admin" | "Engineering" | "Operator" | "Viewer";

type Phase =
  | "idle"
  | "loading"
  | "ready"
  | "denied"
  | "error";

// Validates the existing endpoint response, not a future backend API.
function readRole(value: unknown): Role | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  const user = (value as Record<string, unknown>).user;

  if (
    typeof user !== "object" ||
    user === null ||
    Array.isArray(user)
  ) {
    return null;
  }

  const record = user as Record<string, unknown>;

  if (
    typeof record.id !== "string" ||
    !record.id.trim() ||
    record.id.length > 128
  ) {
    return null;
  }

  const role = record.role;

  return role === "Admin" ||
    role === "Engineering" ||
    role === "Operator" ||
    role === "Viewer"
    ? role
    : null;
}

export default function SessionStatusPanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [role, setRole] = useState<Role | null>(null);

  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    function clearForPrivacy() {
      active.current?.abort();
      active.current = null;
      setRole(null);
      setPhase("idle");
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        clearForPrivacy();
      }
    }

    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        clearForPrivacy();
      }
    }

    document.addEventListener(
      "visibilitychange",
      onVisibilityChange,
    );

    window.addEventListener("pagehide", clearForPrivacy);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );

      window.removeEventListener("pagehide", clearForPrivacy);
      window.removeEventListener("pageshow", onPageShow);

      active.current?.abort();
      active.current = null;
    };
  }, []);

  function clear() {
    active.current?.abort();
    active.current = null;
    setRole(null);
    setPhase("idle");
  }

  async function check() {
    if (active.current || document.visibilityState === "hidden") {
      return;
    }

    const controller = new AbortController();

    active.current = controller;
    setRole(null);
    setPhase("loading");

    try {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (response.status === 401) {
        setPhase("denied");
        return;
      }

      if (!response.ok) {
        setPhase("error");
        return;
      }

      const result = readRole(await response.json());

      if (controller.signal.aborted) return;

      if (result === null) {
        setPhase("error");
        return;
      }

      setRole(result);
      setPhase("ready");
    } catch {
      if (!controller.signal.aborted) {
        setPhase("error");
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
      }
    }
  }

  return (
    <section
      aria-labelledby="session-check-title"
      className="mt-7 rounded-xl border border-slate-200 bg-slate-50 p-4"
    >
      <h3
        id="session-check-title"
        className="font-bold text-slate-900"
      >
        Optional session check
      </h3>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        This checks the existing session endpoint only when clicked and
        may contact Supabase. It does not sign you in, authorize this
        browser, or log you out. Real login and browser authorization
        have not been verified.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={check}
          disabled={phase === "loading"}
          className="rounded-lg border border-blue-700 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          {phase === "loading"
            ? "Checking..."
            : "Check current session"}
        </button>

        <button
          type="button"
          onClick={clear}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Clear / cancel check
        </button>
      </div>

      <div
        aria-live="polite"
        className="mt-3 text-sm leading-6 text-slate-700"
      >
        {phase === "idle" && (
          <p>
            No session check result displayed. No check is made
            automatically.
          </p>
        )}

        {phase === "loading" && (
          <p>Checking the existing session...</p>
        )}

        {phase === "denied" && (
          <p>
            Access is unavailable. A session, browser authorization or
            service issue could be the cause; this response does not
            identify which.
          </p>
        )}

        {phase === "error" && (
          <p>
            Session check unavailable. Please try again later.
          </p>
        )}

        {phase === "ready" && (
          <p>
            The server reported a permitted monitoring session at the
            time of this check. Reported role: <strong>{role}</strong>.
            This is not a continuing access guarantee.
          </p>
        )}
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-500">
        The result clears on tab hiding or page navigation/restoration
        when browser events fire. It does not automatically refresh or
        detect revocation while idle.
      </p>
    </section>
  );
}