import { NextResponse } from "next/server";
import { bearerToken, verifySessionToken, type SessionPayload } from "./session";
import { verifyTelegramInitData } from "./telegram-auth";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export interface AuthContext {
  session: SessionPayload;
  userId: string;
  telegramId: number | null;
}

export type AuthResult =
  | { ok: true; context: AuthContext }
  | { ok: false; response: NextResponse };

function fail(status: number, error: string, detail?: string): AuthResult {
  return {
    ok: false,
    response: NextResponse.json({ ok: false, error, ...(detail ? { detail } : {}) }, { status }),
  };
}

/**
 * Strict server-side gate for every privileged route.
 *
 * Requires BOTH:
 *   1. a session bearer token minted by `/api/telegram-auth` (HS256, verified),
 *   2. when the bot token is configured, a fresh `initData` header whose
 *      HMAC-SHA256 signature validates against `TELEGRAM_BOT_TOKEN` and whose
 *      Telegram user id matches the session.
 *
 * Demo sessions (issued only when no bot token is configured, i.e. local dev)
 * are never accepted on privileged routes.
 */
export function authenticateRequest(
  request: Request,
  options: { allowDemo?: boolean } = {},
): AuthResult {
  const session = verifySessionToken(bearerToken(request));
  if (!session) return fail(401, "unauthorized");

  if (!BOT_TOKEN) {
    // No way to verify Telegram identity without a bot token. Only permitted in
    // local/dev setups where the caller opted into demo mode.
    if (session.demo && !options.allowDemo) return fail(401, "telegram_not_configured");
    return {
      ok: true,
      context: { session, userId: session.sub, telegramId: session.tg ?? null },
    };
  }

  if (session.demo && !options.allowDemo) return fail(401, "demo_session_not_allowed");

  const initData = request.headers.get("x-telegram-init-data");
  if (!initData) return fail(401, "missing_init_data");

  const verified = verifyTelegramInitData(initData, BOT_TOKEN);
  if (!verified) return fail(401, "invalid_init_data");

  if (typeof session.tg === "number" && verified.user.id !== session.tg) {
    return fail(401, "session_mismatch");
  }

  return {
    ok: true,
    context: { session, userId: session.sub, telegramId: verified.user.id },
  };
}
