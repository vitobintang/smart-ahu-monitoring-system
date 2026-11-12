"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface SessionUser {
  id: string;
  email: string;
  username: string | null;
  fullName: string | null;
  role: "Admin" | "Engineering" | "Operator";
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
  const method = (init?.method ?? "GET").toUpperCase();
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(method !== "GET" ? { "x-csrf-token": csrfToken() } : {}),
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
  if (method !== "GET") {
    // Invalidate the related endpoint domain without deleting data (SWR preservation)
    clearPollCache(path.split("?")[0]);
  }
  return data as T;
}

export const LOCAL_POLL_MS = 5000; // FR-24 local-mode fallback polling interval

const POLL_CACHE_MAX = 64;
const pollCache = new Map<string, { data: unknown; ts: number }>();
const inFlightGets = new Map<string, Promise<unknown>>();

/**
 * Soft invalidation: marks cached entries as stale (ts: 0) rather than deleting
 * data completely. This preserves instant 0ms Stale-While-Revalidate (SWR) page
 * transitions without ever flashing blank loading states.
 */
export function clearPollCache(pathOrPrefix?: string) {
  if (pathOrPrefix) {
    for (const [key, entry] of pollCache.entries()) {
      if (key === pathOrPrefix || key.startsWith(pathOrPrefix)) {
        entry.ts = 0;
      }
    }
    for (const key of inFlightGets.keys()) {
      if (key === pathOrPrefix || key.startsWith(pathOrPrefix)) {
        inFlightGets.delete(key);
      }
    }
    return;
  }
  for (const entry of pollCache.values()) {
    entry.ts = 0;
  }
  inFlightGets.clear();
}

/**
 * FR-24: polls the API every ~5 s (local mode) unless paused.
 * Uses stale-while-revalidate caching so navigating back to a previously visited
 * page renders instantly while refreshing fresh data in the background.
 */
export function usePoll<T>(path: string | null, intervalMs = LOCAL_POLL_MS, enabled = true) {
  const cachedEntry = path ? (pollCache.get(path) as { data: T; ts: number } | undefined) : undefined;
  const [data, setData] = useState<T | null>(() => cachedEntry?.data ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !cachedEntry);
  const [paused, setPaused] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(() => cachedEntry?.ts ?? null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!path) return;
    const hit = pollCache.get(path) as { data: T; ts: number } | undefined;
    if (hit) {
      setData(hit.data);
      setLastSync(hit.ts);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }, [path]);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      let req = inFlightGets.get(path) as Promise<T> | undefined;
      if (!req) {
        req = api<T>(path).finally(() => {
          inFlightGets.delete(path);
        });
        inFlightGets.set(path, req);
      }
      const json = await req;
      const now = Date.now();
      if (pollCache.size >= POLL_CACHE_MAX && !pollCache.has(path)) {
        const oldest = pollCache.keys().next().value;
        if (oldest !== undefined) pollCache.delete(oldest);
      }
      pollCache.set(path, { data: json, ts: now });
      if (!mounted.current) return;
      setData(json);
      setError(null);
      setLastSync(now);
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
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void reload();
    }, intervalMs);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) void reload();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      clearInterval(id);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
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

export function fmtDateTime(input: string | number | Date | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB", { hour12: false })}`;
}