import { Capacitor } from "@capacitor/core";
import { auth } from "./firebase";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

export function apiConfigurationError(): string | null {
  if (Capacitor.isNativePlatform() && !API_BASE_URL) {
    return "The mobile build needs VITE_API_BASE_URL set to the deployed HTTPS API before it can connect.";
  }
  return null;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const configError = apiConfigurationError();
  if (configError) throw new Error(configError);
  const user = auth?.currentUser;
  const token = user ? await user.getIdToken() : null;
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new Error("Could not reach the monitoring server. Check your connection and try again.");
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${response.status})`;
    if (response.status === 401 && user) {
      await user.getIdToken(true).catch(() => undefined);
    }
    throw new Error(message);
  }
  return data as T;
}
