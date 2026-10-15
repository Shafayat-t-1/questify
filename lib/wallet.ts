/**
 * Dual-wallet money math — reference implementation.
 *
 * The authoritative arithmetic runs inside the `claim_task` /
 * `request_withdrawal` SECURITY DEFINER RPCs (see
 * `supabase/migrations/005_dual_wallet_referral.sql`) so it is atomic with the
 * balance change. These pure helpers encode the SAME rounding contract so it can
 * be unit-tested and reused by any TypeScript-side display/simulation:
 *
 *   • USDT is stored/settled to 6 decimal places (numeric(18,6)).
 *   • A task margin split sends `round(margin * marketing_pct)` to the marketing
 *     wallet and gives the EXACT remainder to the owner wallet, so
 *     `owner + marketing === margin` with no rounding leak.
 *   • A commission is `round(margin * pct)`.
 *   • The net withdrawal payout is `round(amount - fee)`.
 */

export const USDT_DP = 6;
const USDT_SCALE = 10 ** USDT_DP;

/** Round to 6dp (USDT storage precision). */
export function roundUsdt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * USDT_SCALE) / USDT_SCALE;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export interface MarginSplit {
  owner: number;
  marketing: number;
}

/**
 * Split a task margin into the owner and marketing wallets. The owner always
 * absorbs the rounding remainder so the two parts sum exactly to the margin.
 */
export function splitMargin(
  margin: number,
  ownerPct: number,
  marketingPct: number,
): MarginSplit {
  const m = Math.max(0, Number.isFinite(margin) ? margin : 0);
  const o = clamp01(ownerPct);
  const k = clamp01(marketingPct);
  const normalizedMarketing = o + k <= 0 ? 0 : k;
  const marketing = roundUsdt(m * normalizedMarketing);
  const owner = roundUsdt(m - marketing);
  return { owner, marketing };
}

/** A fee/commission amount: `round(base * pct)`, never negative. */
export function pctOf(base: number, pct: number): number {
  const b = Math.max(0, Number.isFinite(base) ? base : 0);
  return roundUsdt(b * clamp01(pct));
}

/** Net payout after a fee (display + payout amount). Never negative. */
export function netAfterFee(amount: number, fee: number): number {
  const a = Number.isFinite(amount) ? amount : 0;
  const f = Math.max(0, Number.isFinite(fee) ? fee : 0);
  return roundUsdt(Math.max(0, a - f));
}
