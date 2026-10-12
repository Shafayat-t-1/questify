import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Returns the authenticated user's linked provider accounts (real DB state).
 * Nothing here is mocked — a provider only appears as linked if a row exists.
 */
export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.ok) return auth.response;

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: true, data: [] });

  const { data, error } = await admin
    .from("connected_accounts")
    .select("provider, provider_user_id, username, connected_at")
    .eq("user_id", auth.context.userId)
    .order("connected_at", { ascending: false });

  if (error) {
    console.error("[questify] accounts error", error);
    return NextResponse.json({ ok: true, data: [] });
  }

  return NextResponse.json({ ok: true, data: data ?? [] });
}
