import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-only helpers for verifying Telegram WebApp `initData`.
 *
 * The signature scheme is the official one: a secret key derived from the bot
 * token via HMAC-SHA256("WebAppData", bot_token), then HMAC-SHA256(secret,
 * data_check_string) compared against the `hash` field. We never trust any field
 * of `initData` until this check passes.
 */

/** Telegram recommends rejecting initData older than ~24h. */
export const MAX_INIT_DATA_AGE_SECONDS = 60 * 60 * 24;

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

export interface VerifiedInitData {
  user: TelegramUser;
  authDate: number;
  startParam: string | null;
  queryId: string | null;
}

/** Timing-safe comparison of two hex/utf8 strings of equal length. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validate a `initData` string against the bot token. Returns the parsed payload
 * only when the HMAC signature is valid AND `auth_date` is fresh. Returns null
 * for any malformed, unsigned, tampered, or stale payload.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number = MAX_INIT_DATA_AGE_SECONDS,
): VerifiedInitData | null {
  if (!initData || !botToken) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();

  // The data-check-string excludes `hash`. Newer clients also send a `signature`
  // (Ed25519) field that is not part of the bot-token HMAC, so we accept either
  // form to stay compatible across Telegram client versions.
  const buildString = (entries: [string, string][]) =>
    entries
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("\n");

  const allEntries = [...params.entries()];
  const withoutSignature = allEntries.filter(([k]) => k !== "signature");

  const matches = (entries: [string, string][]) => {
    const computed = createHmac("sha256", secretKey)
      .update(buildString(entries))
      .digest("hex");
    return safeEqual(computed, hash);
  };

  const signatureValid =
    matches(withoutSignature) || (withoutSignature.length !== allEntries.length && matches(allEntries));

  if (!signatureValid) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (maxAgeSeconds > 0 && Date.now() / 1000 - authDate > maxAgeSeconds) return null;

  const rawUser = params.get("user");
  if (!rawUser) return null;

  let user: TelegramUser;
  try {
    user = JSON.parse(rawUser) as TelegramUser;
  } catch {
    return null;
  }
  if (!user || !Number.isFinite(user.id)) return null;

  return {
    user,
    authDate,
    startParam: params.get("start_param"),
    queryId: params.get("query_id"),
  };
}

/** Parse the `user` field without verifying the signature (never trust this). */
export function parseTelegramUser(initData: string): TelegramUser | null {
  if (!initData) return null;
  try {
    const raw = new URLSearchParams(initData).get("user");
    if (!raw) return null;
    const user = JSON.parse(raw) as TelegramUser;
    return user && Number.isFinite(user.id) ? user : null;
  } catch {
    return null;
  }
}
