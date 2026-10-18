import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSettings, type RateLimitRule } from "./settings";

/**
 * Application wrapper around the Postgres `check_rate_limit` fixed-window
 * limiter (supabase/migrations/004_money_safety.sql). The database does the
 * counting atomically; this module only reads the admin-tunable rule from
 * `platform_settings` and maps the outcome to an HTTP response.
 *
 * A rate limit is a defence-in-depth on top of the RPC's own money guards: if
 * the limiter itself is unavailable (e.g. migration not yet applied) we fail
 * OPEN so a missing function never blocks legitimate users.
 */

export const RATE_LIMIT_ACTIONS = [
  "claim_task",
  "checkin",
  "withdraw",
  "accounts",
  "oauth",
  "broadcast",
  "notify",
  "referral",
] as const;

export type RateLimitAction = (typeof RATE_LIMIT_ACTIONS)[number];

export interface RateLimitOutcome {
  allowed: boolean;
  limit: number;
  windowSeconds: number;
}

/** Check (and increment) one action's window for an identifier (user id / IP). */
export async function checkRateLimit(
  admin: SupabaseClient | null,
  action: RateLimitAction,
  identifier: string | null | undefined,
): Promise<RateLimitOutcome> {
  const settings = await loadSettings(admin);
  const rule: RateLimitRule =
    settings.rateLimits[action] ?? { max: 0, window_seconds: 60 };

  // No rule, no identifier, or limiting disabled → allow.
  if (!admin || !identifier || rule.max <= 0) {
    return { allowed: true, limit: rule.max, windowSeconds: rule.window_seconds };
  }

  try {
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: `rl:${action}:${identifier}`,
      p_max: rule.max,
      p_window_seconds: rule.window_seconds,
    });
    if (error) throw error;
    // The function returns true when the hit is within the window.
    return { allowed: data !== false, limit: rule.max, windowSeconds: rule.window_seconds };
  } catch (err) {
    console.error("[questify] rate limit check failed", err);
    return { allowed: true, limit: rule.max, windowSeconds: rule.window_seconds };
  }
}

/** 429 response carrying a `Retry-After` hint derived from the window. */
export function rateLimitedResponse(outcome: RateLimitOutcome): NextResponse {
  const retryAfter = Math.max(1, Math.trunc(outcome.windowSeconds));
  return NextResponse.json(
    { ok: false, error: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/** Best-effort client IP for unauthenticated endpoints (notify, referral). */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}
