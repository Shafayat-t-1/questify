import { NextResponse } from "next/server";
import { authenticateMcc } from "@/lib/mcc-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  MCC_SESSION_TTL_SECONDS,
  mccClearCookieHeader,
  mccCookieHeader,
  signSession,
} from "@/lib/session";
import {
  verifyTelegramLoginWidget,
  type TelegramLoginFields,
} from "@/lib/telegram-login";

/**
 * Telegram Login Widget authentication for the standalone /mcc control center.
 *
 * The widget (embedded on /mcc/login) delivers a flat object through its
 * `data-onauth` callback; the browser POSTs it here unmodified. NOTHING is
 * trusted until the widget HMAC (lib/telegram-login.ts) validates against
 * TELEGRAM_BOT_TOKEN and the payload is fresh. On success the user must exist
 * in `profiles` (matched on telegram_id) AND have `is_admin = true`; only then
 * is a cookie-scoped session token minted. A signed-in non-admin Telegram
 * account gets 403 and no cookie.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/** Login attempts allowed per telegram id per minute (defence in depth). */
const LOGIN_RATE_MAX = 10;
const LOGIN_RATE_WINDOW_SECONDS = 60;

function fail(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

async function hitLoginRateLimit(admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>, tgId: number): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: `rl:mcc_login:${tgId}`,
      p_max: LOGIN_RATE_MAX,
      p_window_seconds: LOGIN_RATE_WINDOW_SECONDS,
    });
    if (error) return true; // fail open if the limiter is not applied yet
    return data !== false;
  } catch {
    return true;
  }
}

export async function POST(request: Request) {
  if (!BOT_TOKEN) return fail(503, "telegram_not_configured");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "invalid_json");
  }
  if (!body || typeof body !== "object") return fail(400, "invalid_body");

  // Accept both the flat widget object and a { user: {...} } wrapper.
  const raw = (body.user && typeof body.user === "object" ? body.user : body) as TelegramLoginFields;
  const fields: TelegramLoginFields = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" || typeof value === "number") fields[key] = value;
  }

  const user = verifyTelegramLoginWidget(fields, BOT_TOKEN);
  if (!user) return fail(401, "invalid_login_signature");

  const admin = getSupabaseAdmin();
  if (!admin) return fail(503, "not_configured");

  if (!(await hitLoginRateLimit(admin, user.id))) return fail(429, "rate_limited");

  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, is_admin")
    .eq("telegram_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[questify] mcc-auth lookup failed", error);
    return fail(500, "lookup_failed");
  }
  if (!profile) return fail(403, "unknown_user");
  if (!(profile as { is_admin: boolean | null }).is_admin) return fail(403, "forbidden");

  const token = signSession(
    { sub: (profile as { id: string }).id, tg: user.id, purpose: "mcc" },
    MCC_SESSION_TTL_SECONDS,
  );

  const response = NextResponse.json({ ok: true, redirectTo: "/mcc" });
  response.headers.set("Set-Cookie", mccCookieHeader(token, MCC_SESSION_TTL_SECONDS));
  return response;
}

/** Current session status for /mcc/login and the MCC header. */
export async function GET(request: Request) {
  const auth = await authenticateMcc(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({
    ok: true,
    data: {
      username: auth.context.username,
      telegramId: auth.context.telegramId,
      isFounder: auth.context.isFounder,
    },
  });
}

/** Logout: clear the MCC cookie. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", mccClearCookieHeader());
  return response;
}
