import { createHmac } from "node:crypto";

/**
 * Builds a real, HMAC-signed Telegram `initData` string for tests, using the
 * exact scheme `verifyTelegramInitData` validates:
 *   secret = HMAC_SHA256("WebAppData", bot_token)
 *   hash   = HMAC_SHA256(secret, data_check_string)
 */

export const TEST_BOT_TOKEN = "123456:TEST-BOT-TOKEN";

export interface SignInitDataParams {
  user: {
    id: number;
    first_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
    photo_url?: string;
  };
  auth_date?: number;
  start_param?: string;
}

export function signInitData(params: SignInitDataParams, botToken: string = TEST_BOT_TOKEN): string {
  const fields: Record<string, string> = {
    user: JSON.stringify(params.user),
    auth_date: String(params.auth_date ?? Math.floor(Date.now() / 1000)),
  };
  if (params.start_param !== undefined) fields.start_param = params.start_param;

  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  return new URLSearchParams({ ...fields, hash }).toString();
}
