import { createClient } from "npm:@supabase/supabase-js@2";

// Service role key: full access, bypasses row level security. Only
// ever used server-side, inside this Edge Function. Never send this
// key to a client.
export function getSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as " +
        "function secrets (supabase secrets set ...).",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
