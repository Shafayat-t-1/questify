/**
 * Referral-code resolution (pure, framework-free, unit-testable).
 *
 * A referral code can arrive from three different Telegram entry points, in
 * priority order:
 *
 *   1. `initData.start_param`               — a Mini App opened via `?startapp=`.
 *   2. `tgWebAppStartParam` (URL query/hash) — a direct-link Mini App.
 *   3. `?ref=` query param                  — the bot's `/start CODE` web_app button.
 *
 * The first non-empty value wins. Returns null when none are present.
 */

export interface ReferralSources {
  /** `start_param` from the verified Telegram initData. */
  initDataStartParam?: string | null;
  /** The current Mini App URL (e.g. `window.location.href`). */
  href?: string | null;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Extract the referral code from the URL's query and hash fragments. */
function fromUrl(href: string): { tgStartParam: string | null; ref: string | null } {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { tgStartParam: null, ref: null };
  }

  const queryTg = nonEmpty(url.searchParams.get("tgWebAppStartParam"));
  if (queryTg) return { tgStartParam: queryTg, ref: null };

  const rawHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (rawHash) {
    const hashParams = new URLSearchParams(rawHash);
    const hashTg = nonEmpty(hashParams.get("tgWebAppStartParam"));
    if (hashTg) return { tgStartParam: hashTg, ref: null };
  }

  return { tgStartParam: null, ref: nonEmpty(url.searchParams.get("ref")) };
}

/** Resolve the referral code, or null when no source provides one. */
export function resolveReferralCode({ initDataStartParam, href }: ReferralSources): string | null {
  const fromInit = nonEmpty(initDataStartParam);
  if (fromInit) return fromInit;

  if (!href) return null;
  const { tgStartParam, ref } = fromUrl(href);
  return tgStartParam ?? ref ?? null;
}
