import { createHash, randomBytes } from "node:crypto";
import { signSession, verifySessionToken, type SessionPayload } from "./session";

/**
 * Bot-issued magic links for the /mcc control center (Phase 3A-FIX).
 *
 * The `/login` bot command mints a raw token with a DISTINCT claim shape from
 * the mcc cookie session (`purpose: "mcc_magic"` + `jti`, no `tg`) and a 5
 * minute TTL. The raw token travels only inside the link the bot sends; the
 * database stores `hashMccMagicToken(token)` — SHA-256 of the raw value — so
 * a DB read alone cannot mint a session. Redemption happens in
 * /api/mcc-magic: signature + purpose verification AND a one-time hash
 * lookup are both required.
 */

export const MCC_MAGIC_PURPOSE = "mcc_magic";

/** Single-use lifetime of a magic link (matches the bot's reply copy). */
export const MCC_MAGIC_TTL_SECONDS = 5 * 60;

/** Claim shape of a magic token — deliberately NOT the mcc cookie shape. */
export interface MagicTokenPayload extends SessionPayload {
  purpose: typeof MCC_MAGIC_PURPOSE;
  jti: string;
}

/** Mint a single-use magic token bound to a profile id (user id). */
export function signMccMagicToken(userId: string): string {
  return signSession(
    {
      sub: userId,
      purpose: MCC_MAGIC_PURPOSE,
      jti: randomBytes(16).toString("hex"),
    },
    MCC_MAGIC_TTL_SECONDS,
  );
}

/**
 * Verify a magic token's signature, expiry (via verifySessionToken) and
 * purpose. An mcc cookie session (`purpose: "mcc"`) or a Mini App bearer
 * token (no purpose) is always rejected here.
 */
export function verifyMccMagicToken(token: string | null | undefined): MagicTokenPayload | null {
  const payload = verifySessionToken(token);
  if (!payload) return null;
  if (payload.purpose !== MCC_MAGIC_PURPOSE) return null;
  const { jti } = payload;
  if (typeof jti !== "string" || jti.length === 0) return null;
  return { ...payload, purpose: MCC_MAGIC_PURPOSE, jti };
}

/** SHA-256 hex digest of the raw token — the only value ever stored. */
export function hashMccMagicToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
