/**
 * Central, brand-agnostic runtime configuration.
 *
 * Nothing about the brand or bot is hard-coded across the app — referral links,
 * share buttons and the welcome message all derive from here. Rotating the brand
 * (new bot username, new app URL) is a one-line env change (`NEXT_PUBLIC_*`) or
 * a `platform_settings` row, and existing users keep their data because identity
 * is keyed on `profiles.id` / `profiles.referral_code`, never on the bot handle.
 */

export interface PublicConfig {
  brandName: string;
  botUsername: string;
  appUrl: string;
  miniappShortname: string | null;
  minWithdrawalUsdt: number;
  supportUsername: string | null;
}

const DEFAULTS: PublicConfig = {
  brandName: "Questify",
  botUsername: "questify_app_bot",
  appUrl: "https://questify-nine-tau.vercel.app",
  miniappShortname: null,
  minWithdrawalUsdt: 1,
  supportUsername: null,
};

/** Config available at build time from public env vars (client + server). */
export function envConfig(): PublicConfig {
  return {
    brandName: process.env.NEXT_PUBLIC_BRAND_NAME || DEFAULTS.brandName,
    botUsername: process.env.NEXT_PUBLIC_BOT_USERNAME || DEFAULTS.botUsername,
    appUrl: process.env.NEXT_PUBLIC_APP_URL || DEFAULTS.appUrl,
    miniappShortname: process.env.NEXT_PUBLIC_MINIAPP_SHORTNAME || DEFAULTS.miniappShortname,
    minWithdrawalUsdt: Number(process.env.NEXT_PUBLIC_MIN_WITHDRAWAL_USDT) || DEFAULTS.minWithdrawalUsdt,
    supportUsername: process.env.NEXT_PUBLIC_SUPPORT_USERNAME || DEFAULTS.supportUsername,
  };
}

/** Plain deep link that opens the bot chat. */
export function botLink(config: PublicConfig): string {
  return `https://t.me/${config.botUsername}`;
}

/**
 * Referral deep link for a user's own code.
 *
 * Uses the `?startapp=` parameter (delivered to the Mini App as
 * `initData.start_param`) — NOT `?start=`, which is a bot-chat payload that
 * never reaches the Mini App. When `NEXT_PUBLIC_MINIAPP_SHORTNAME` is set the
 * direct-link form `t.me/<bot>/<shortname>?startapp=` is used.
 */
export function referralLink(config: PublicConfig, referralCode: string | null | undefined): string {
  if (!referralCode) return botLink(config);
  const base = config.miniappShortname
    ? `https://t.me/${config.botUsername}/${config.miniappShortname}`
    : `https://t.me/${config.botUsername}`;
  return `${base}?startapp=${encodeURIComponent(referralCode)}`;
}

/** Share URL usable with Telegram's `shareURL` / native share sheet. */
export function referralShareUrl(config: PublicConfig, referralCode: string | null | undefined): string {
  const link = referralLink(config, referralCode);
  const text = `Join me on ${config.brandName} — complete tasks and earn real USDT.`;
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}
