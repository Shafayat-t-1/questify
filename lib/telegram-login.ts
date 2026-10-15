import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-only verifier for the official Telegram Login Widget
 * (https://core.telegram.org/widgets/login — legacy widget spec at
 * /widgets/login-legacy).
 *
 * This is a DIFFERENT signature scheme from the Mini App `initData` check in
 * `lib/telegram-auth.ts` and must never be mixed with it:
 *
 *   data_check_string = all received fields except `hash`, sorted
 *                       alphabetically, joined as `key=value` with `\n`
 *   secret_key        = SHA256(<bot_token>)          (raw binary digest)
 *   hash              = hex(HMAC_SHA256(data_check_string, secret_key))
 *
 * The bot token is the only shared secret; `auth_date` freshness is the only
 * replay defence, so stale payloads are rejected.
 */

/** Telegram recommends rejecting widget auth payloads older than ~24h. */
export const MAX_LOGIN_WIDGET_AGE_SECONDS = 60 * 60 * 24;

export interface TelegramLoginWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
}

export type TelegramLoginFields = Record<string, string | number | undefined>;

const REQUIRED_FIELDS = ["id", "first_name", "auth_date", "hash"] as const;

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validate the flat field object the widget returns (either from the
 * `data-onauth` callback or from a `data-auth-url` redirect). Returns the
 * parsed user only when the HMAC is valid AND `auth_date` is fresh; null for
 * any malformed, unsigned, tampered or stale payload.
 */
export function verifyTelegramLoginWidget(
  fields: TelegramLoginFields,
  botToken: string,
  maxAgeSeconds: number = MAX_LOGIN_WIDGET_AGE_SECONDS,
): TelegramLoginWidgetUser | null {
  if (!fields || typeof fields !== "object" || !botToken) return null;

  for (const key of REQUIRED_FIELDS) {
    const value = fields[key];
    if (value === undefined || value === null || String(value).length === 0) return null;
  }

  const hash = String(fields.hash).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;

  // Data-check-string: every received field EXCEPT `hash`, sorted
  // alphabetically, `key=value` joined with a line feed.
  const entries = Object.entries(fields)
    .filter(([key, value]) => key !== "hash" && value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join("\n");

  // Official widget spec: secret_key = SHA256(<bot_token>) as a raw digest,
  // then hash = hex(HMAC_SHA256(data_check_string, secret_key)).
  const secretKey = createHash("sha256").update(botToken).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!safeEqualHex(computed, hash)) return null;

  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (maxAgeSeconds > 0 && Date.now() / 1000 - authDate > maxAgeSeconds) return null;

  const id = Number(fields.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const firstName = String(fields.first_name);
  if (!firstName) return null;

  return {
    id,
    first_name: firstName,
    last_name: fields.last_name ? String(fields.last_name) : undefined,
    username: fields.username ? String(fields.username) : undefined,
    photo_url: fields.photo_url ? String(fields.photo_url) : undefined,
    auth_date: authDate,
  };
}
