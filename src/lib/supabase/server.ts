import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL and publishable key are required");
  return { url, key };
}

export async function createSupabaseServerClient() {
  const { url, key } = config();
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        // Server Components cannot set cookies; src/proxy.ts handles refreshes.
        try {
          items.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* refreshed by proxy */
        }
      },
    },
  });
}

/** Privileged Auth administration only. Never import this into client code. */
export function createSupabaseAdminClient() {
  const { url } = config();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for user administration");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}