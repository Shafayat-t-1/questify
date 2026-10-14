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
 * Two Telegram link shapes deliver a referral code, and only these two:
 *
 *   1. Direct-Link Mini App: `t.me/<bot>/<shortname>?startapp=<code>` — reaches
 *      the Mini App as `initData.start_param`. Used when a short name is set.
 *   2. Bot link: `t.me/<bot>?start=<code>` — invokes `messages.startBot`, so the
 *      bot receives `/start <code>` and stores it as a pending referral. This is
 *      the fallback when no short name is configured, because the bare
 *      `t.me/<bot>?startapp=` form requires a Main Mini App to be set in
 *      BotFather — otherwise the link silently loses the code.
 *
 * It never emits a `web_app` button URL, which cannot carry a start parameter.
 */
export function referralLink(config: PublicConfig, referralCode: string | null | undefined): string {
  if (!referralCode) return botLink(config);
  const code = encodeURIComponent(referralCode);
  if (config.miniappShortname) {
    return `https://t.me/${config.botUsername}/${config.miniappShortname}?startapp=${code}`;
  }
  return `https://t.me/${config.botUsername}?start=${code}`;
}

/** Share URL usable with Telegram's `shareURL` / native share sheet. */
export function referralShareUrl(config: PublicConfig, referralCode: string | null | undefined): string {
  const link = referralLink(config, referralCode);
  const text = `Join me on ${config.brandName} — complete tasks and earn real USDT.`;
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}
