import { NextResponse } from "next/server";
import { loadMccAdminProfile } from "@/lib/mcc-auth";
import { hashMccMagicToken, verifyMccMagicToken } from "@/lib/mcc-magic";
import {
  MCC_SESSION_TTL_SECONDS,
  mccCookieHeader,
  signSession,
} from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Redeems a bot-issued magic link (Phase 3A-FIX, primary /mcc auth path).
 *
 * Order of checks, mirroring the widget path's "verify first, decide later"
 * posture — a session cookie is minted only after ALL of them pass:
 *   1. token present, 2. row found by SHA-256 hash, 3. not already used,
 *   4. not expired, 5. signed token valid (purpose 'mcc_magic'), 6. token's
 *   sub matches the stored row's user, 7. atomic one-time claim
 *   (UPDATE … WHERE used_at IS NULL, row count checked — the Phase 2B
 *   instant-bonus guard pattern), 8. is_admin still true.
 * Every failure redirects to /mcc/login with a clear error and NO session.
 */

type ErrorCode =
  | "missing"
  | "not_found"
  | "used"
  | "expired"
  | "invalid"
  | "forbidden"
  | "unavailable";

function fail(request: Request, code: ErrorCode): NextResponse {
  return NextResponse.redirect(new URL(`/mcc/login?error=${code}`, request.url));
}

interface MagicRow {
  user_id: string;
  expires_at: string;
  used_at: string | null;
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return fail(request, "missing");

  const admin = getSupabaseAdmin();
  if (!admin) return fail(request, "unavailable");

  const tokenHash = hashMccMagicToken(token);
  const { data, error } = await admin
    .from("mcc_magic_tokens")
    .select("user_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) {
    console.error("[questify] magic token lookup failed", error);
    return fail(request, "unavailable");
  }

  const row = data as MagicRow | null;
  if (!row) return fail(request, "not_found");
  if (row.used_at) return fail(request, "used");
  if (Date.parse(row.expires_at) <= Date.now()) return fail(request, "expired");

  // The DB read alone must never be enough: the raw token must also carry a
  // valid 'mcc_magic' signature bound to this exact row's user.
  const payload = verifyMccMagicToken(token);
  if (!payload || payload.sub !== row.user_id) return fail(request, "invalid");

  // Atomic single-use claim. A concurrent redeem blocks on the row and then
  // sees used_at set, so the UPDATE matches zero rows and fails below.
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("mcc_magic_tokens")
    .update({ used_at: nowIso })
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gte("expires_at", nowIso)
    .select("user_id");
  if (claimError) {
    console.error("[questify] magic token claim failed", claimError);
    return fail(request, "unavailable");
  }
  if (!Array.isArray(claimed) || claimed.length !== 1) {
    // Lost a race (or expired between the check and the claim). Re-read to
    // report the accurate reason; either way no session is minted.
    const { data: after } = await admin
      .from("mcc_magic_tokens")
      .select("used_at, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    const state = after as Pick<MagicRow, "used_at" | "expires_at"> | null;
    if (state?.used_at) return fail(request, "used");
    if (state && Date.parse(state.expires_at) <= Date.now()) return fail(request, "expired");
    return fail(request, "used");
  }

  // Re-confirm admin rights at redemption time — a demoted admin's outstanding
  // links must die even though the webhook only ever minted them for admins.
  const context = await loadMccAdminProfile(row.user_id);
  if (!context) return fail(request, "forbidden");

  const session = signSession(
    { sub: context.adminId, tg: context.telegramId ?? undefined, purpose: "mcc" },
    MCC_SESSION_TTL_SECONDS,
  );
  const response = NextResponse.redirect(new URL("/mcc", request.url));
  response.headers.set("Set-Cookie", mccCookieHeader(session, MCC_SESSION_TTL_SECONDS));
  return response;
}
