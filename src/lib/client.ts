"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  role: "Admin" | "Engineering" | "Operator" | "Viewer";
  createdAt: string;
}

export interface SyncInfo {
  mode: "CLOUD" | "LOCAL";
  firebaseConfigured: boolean;
  pollingIntervalSec: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  queuedItems: number;
}

/** Reads the double-submit CSRF cookie (NFR-01). */
export function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)ahu_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.method && init.method !== "GET" ? { "x-csrf-token": csrfToken() } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export const LOCAL_POLL_MS = 5000; // FR-24 local-mode fallback polling interval

/** FR-24: polls the API every ~5 s (local mode) unless paused. */
export function usePoll<T>(path: string | null, intervalMs = LOCAL_POLL_MS, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const json = await api<T>(path);
      if (!mounted.current) return;
      setData(json);
      setError(null);
      setLastSync(Date.now());
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!enabled || !path) return;
    void reload();
    if (paused) return;
    const id = setInterval(() => void reload(), intervalMs);
    return () => clearInterval(id);
  }, [reload, intervalMs, paused, enabled, path]);

  return { data, error, loading, reload, paused, setPaused, lastSync };
}

export function timeAgo(input: string | number | Date | null | undefined, now = Date.now()): string {
  if (input === null || input === undefined) return "never";
  const t = new Date(input).getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function fmtTime(input: string | number | Date | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function fmtDateTime(input: string | number | Date | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB", { hour12: false })}`;
}