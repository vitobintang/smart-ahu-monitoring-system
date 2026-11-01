import { test } from "node:test";
import { deepStrictEqual, throws } from "node:assert/strict";

import { getSupabaseConfig } from "../src/lib/supabase/config";

test("accepts a URL and publishable key", () => {
  deepStrictEqual(
    getSupabaseConfig("https://example.supabase.co", "sb_publishable_example"),
    {
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_example",
    },
  );
});

test("rejects missing configuration", () => {
  throws(() => getSupabaseConfig(undefined, "example"), /required/);
  throws(() => getSupabaseConfig("https://example.supabase.co", ""), /required/);
});

test("rejects invalid or insecure URLs", () => {
  throws(() => getSupabaseConfig("not-a-url", "example"), /HTTPS/);
  throws(() => getSupabaseConfig("http://example.com", "example"), /HTTPS/);
  throws(() => getSupabaseConfig("https://user:pass@example.com", "example"), /HTTPS/);
});

test("rejects a modern Supabase secret key", () => {
  throws(
    () => getSupabaseConfig("https://example.supabase.co", "sb_secret_example"),
    /publishable key/,
  );
});