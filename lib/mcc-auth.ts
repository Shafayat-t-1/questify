import { NextResponse } from "next/server";
import {
  MCC_SESSION_COOKIE,
  readCookieToken,
  verifySessionToken,
  type SessionPayload,
} from "./session";
import { getSupabaseAdmin } from "./supabase";

/**
 * Server-only auth for the standalone /mcc control center.
 *
 * Delivery mechanism #2 of the single Questify session token: the browser
 * holds it in an httpOnly cookie (the Mini App holds the same token in an
 * Authorization header). `verifySessionToken` and `QUESTIFY_JWT_SECRET` are
 * shared — only the transport differs.
 *
 * Every /mcc page gate and every API route the control center calls must go
 * through `authenticateMcc` (or the layout's `verifyMccSession`) — there is no
 * client-side-only protection anywhere in /mcc.
 */

export { MCC_SESSION_COOKIE };

export interface MccContext {
  adminId: string;
  telegramId: number | null;
  username: string | null;
  isFounder: boolean;
}

export type MccAuthResult =
  | { ok: true; context: MccContext }
  | { ok: false; response: NextResponse };

export interface MccSessionPayload extends SessionPayload {
  purpose?: string;
}

/**
 * Verify a raw MCC cookie token. Returns the payload only for a valid,
 * unexpired, MCC-scoped session. A Mini App token (no `purpose`) placed in the
 * cookie is rejected: cookies are only ever minted for /mcc.
 */
export function verifyMccToken(token: string | null | undefined): MccSessionPayload | null {
  const payload = verifySessionToken(token);
  if (!payload) return null;
  if (payload.purpose !== "mcc") return null;
  return payload;
}

/** Read + verify the MCC cookie on an incoming request. */
export function mccTokenFromRequest(request: Request): MccSessionPayload | null {
  return verifyMccToken(readCookieToken(request, MCC_SESSION_COOKIE));
}

/**
 * Load the caller's profile and enforce `is_admin = true`.
 * Used by API routes AND by the /mcc server layout gate. Returns null on any
 * failure (no session, no profile, not admin) — callers fail closed.
 */
export async function loadMccAdminProfile(
  userId: string,
): Promise<MccContext | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  try {
    const { data, error } = await admin
      .from("profiles")
      .select("id, telegram_id, username, is_admin, is_founder")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      id: string;
      telegram_id: number | null;
      username: string | null;
      is_admin: boolean | null;
      is_founder: boolean | null;
    };
    if (!row.is_admin) return null; // is_founder is cosmetic and never tested here
    return {
      adminId: row.id,
      telegramId: row.telegram_id ?? null,
      username: row.username ?? null,
      isFounder: Boolean(row.is_founder),
    };
  } catch {
    return null;
  }
}

/** Verify the cookie on a request and confirm the caller is an admin. */
export async function authenticateMcc(request: Request): Promise<MccAuthResult> {
  const payload = mccTokenFromRequest(request);
  if (!payload) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }),
    };
  }
  const context = await loadMccAdminProfile(payload.sub);
  if (!context) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, context };
}
