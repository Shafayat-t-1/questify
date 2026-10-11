import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * True when the public Supabase credentials are present. The app degrades
 * gracefully to a local (offline) data source when they are missing so it can
 * always boot inside Termux / a dev sandbox.
 */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;

function createBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  return createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "x-application-name": "questify" },
    },
    realtime: { params: { eventsPerSecond: 4 } },
  });
}

/**
 * Shared browser/client Supabase instance. `null` when env vars are absent.
 */
export function getSupabase(): SupabaseClient | null {
  if (!client) client = createBrowserClient();
  return client;
}

/** Convenience proxy so `supabase.from(...)` reads naturally in components. */
export const supabase: SupabaseClient | null = getSupabase();

/**
 * Server-only elevated client used by API routes to write trusted records
 * (balances, withdrawals, rewards). Never import this into a client component.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
