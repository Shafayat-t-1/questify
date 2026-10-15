import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side economics/config loader.
 *
 * Every business number (commission, fees, coin rate, check-in schedule, level
 * size, trust deltas, rate limits…) lives in the `platform_settings` table so the
 * operator can change it from the admin panel AND from a fresh request. This
 * module reads those rows on the server and coerces them to typed values with
 * safe defaults, so a missing/newly-added setting never breaks a request.
 *
 * Rows are cached in-process for a short TTL to avoid a settings round-trip on
 * every reward call. `invalidateSettingsCache()` clears it after an admin write;
 * the TTL is the cross-instance backstop (writes on one instance are visible to
 * another within TTL — no redeploy required).
 */

export interface RateLimitRule {
  max: number;
  window_seconds: number;
}

/** A single referral milestone: `bonus_usdt` paid once `referral_count` is reached. */
export interface MilestoneRule {
  referralCount: number;
  bonusUsdt: number;
}

export interface Settings {
  /** @deprecated replaced by the tiered commission keys below (dual-wallet model). */
  referralCommissionPct: number;
  ownerWalletSplitPct: number;
  marketingWalletSplitPct: number;
  referralTier1CommissionPct: number;
  referralTier2CommissionPct: number;
  referralInstantBonusCoins: number;
  referralInstantBonusUsdt: number;
  referralBonusMinTasks: number;
  referralMilestoneRules: MilestoneRule[];
  referralSignupRewardCoins: number;
  referralSignupRewardUsdt: number;
  coinToUsdtRate: number;
  withdrawalFeeBep20: number;
  withdrawalFeeTon: number;
  checkinRewardSchedule: number[];
  checkinMultiplierSchedule: number[];
  levelCoinsPerLevel: number;
  trustScoreTaskDelta: number;
  trustScoreCheckinDelta: number;
  trustScoreCap: number;
  trustThresholdForWithdrawal: number;
  minWithdrawalUsdt: number;
  leaderboardSeasonLabel: string;
  leaderboardResetLabel: string;
  leaderboardRewardNote: string;
  rateLimits: Record<string, RateLimitRule>;
}

/** Mirror of the seeds in supabase/schema.sql + 004_money_safety.sql. */
export const SETTINGS_DEFAULTS: Settings = {
  referralCommissionPct: 0.1,
  ownerWalletSplitPct: 0.95,
  marketingWalletSplitPct: 0.05,
  referralTier1CommissionPct: 0.03,
  referralTier2CommissionPct: 0.02,
  referralInstantBonusCoins: 150,
  referralInstantBonusUsdt: 0.03,
  referralBonusMinTasks: 3,
  referralMilestoneRules: [
    { referralCount: 5, bonusUsdt: 1 },
    { referralCount: 25, bonusUsdt: 5 },
  ],
  referralSignupRewardCoins: 150,
  referralSignupRewardUsdt: 0.03,
  coinToUsdtRate: 0.0002,
  withdrawalFeeBep20: 1,
  withdrawalFeeTon: 0.5,
  checkinRewardSchedule: [100, 150, 220, 320, 450, 600, 1000],
  checkinMultiplierSchedule: [1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2.5],
  levelCoinsPerLevel: 1000,
  trustScoreTaskDelta: 1,
  trustScoreCheckinDelta: 2,
  trustScoreCap: 100,
  trustThresholdForWithdrawal: 30,
  minWithdrawalUsdt: 1,
  leaderboardSeasonLabel: "Season 1",
  leaderboardResetLabel: "resets in 6 days",
  leaderboardRewardNote: "Top 100 rewarded",
  rateLimits: {
    claim_task: { max: 30, window_seconds: 60 },
    checkin: { max: 5, window_seconds: 60 },
    withdraw: { max: 5, window_seconds: 300 },
    accounts: { max: 20, window_seconds: 60 },
    broadcast: { max: 3, window_seconds: 60 },
    notify: { max: 60, window_seconds: 60 },
    referral: { max: 30, window_seconds: 60 },
  },
};

const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: Settings } | null = null;

/** Drop the in-process settings cache (call after an admin write). */
export function invalidateSettingsCache(): void {
  cache = null;
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const out = value.map((v) => num(v, NaN)).filter((n) => Number.isFinite(n));
  return out.length > 0 ? out : fallback;
}

function parseRateLimits(value: unknown): Record<string, RateLimitRule> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return SETTINGS_DEFAULTS.rateLimits;
  }
  const out: Record<string, RateLimitRule> = { ...SETTINGS_DEFAULTS.rateLimits };
  for (const [key, rule] of Object.entries(value as Record<string, unknown>)) {
    if (!rule || typeof rule !== "object") continue;
    const max = num((rule as Record<string, unknown>).max, NaN);
    const windowSeconds = num((rule as Record<string, unknown>).window_seconds, NaN);
    if (Number.isFinite(max) && Number.isFinite(windowSeconds)) {
      out[key] = { max: Math.max(0, Math.trunc(max)), window_seconds: Math.max(1, Math.trunc(windowSeconds)) };
    }
  }
  return out;
}

function parseMilestoneRules(value: unknown): MilestoneRule[] {
  if (!Array.isArray(value)) return SETTINGS_DEFAULTS.referralMilestoneRules;
  const out: MilestoneRule[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const count = num((entry as Record<string, unknown>).referral_count, NaN);
    const bonus = num((entry as Record<string, unknown>).bonus_usdt, NaN);
    if (Number.isFinite(count) && Number.isFinite(bonus) && count > 0 && bonus > 0) {
      out.push({ referralCount: Math.trunc(count), bonusUsdt: bonus });
    }
  }
  return out.length > 0 ? out : SETTINGS_DEFAULTS.referralMilestoneRules;
}

/** Coerce raw `platform_settings` rows into a typed Settings object. */
export function parseSettings(rows: Array<{ key: string; value: unknown }>): Settings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const d = SETTINGS_DEFAULTS;
  return {
    referralCommissionPct: num(map.get("referral_commission_pct"), d.referralCommissionPct),
    ownerWalletSplitPct: num(map.get("owner_wallet_split_pct"), d.ownerWalletSplitPct),
    marketingWalletSplitPct: num(
      map.get("marketing_wallet_split_pct"),
      d.marketingWalletSplitPct,
    ),
    referralTier1CommissionPct: num(
      map.get("referral_tier1_commission_pct"),
      d.referralTier1CommissionPct,
    ),
    referralTier2CommissionPct: num(
      map.get("referral_tier2_commission_pct"),
      d.referralTier2CommissionPct,
    ),
    referralInstantBonusCoins: num(
      map.get("referral_instant_bonus_coins"),
      d.referralInstantBonusCoins,
    ),
    referralInstantBonusUsdt: num(
      map.get("referral_instant_bonus_usdt"),
      d.referralInstantBonusUsdt,
    ),
    referralBonusMinTasks: Math.max(
      1,
      num(map.get("referral_bonus_min_tasks"), d.referralBonusMinTasks),
    ),
    referralMilestoneRules: parseMilestoneRules(map.get("referral_milestone_rules")),
    referralSignupRewardCoins: num(
      map.get("referral_signup_reward_coins"),
      d.referralSignupRewardCoins,
    ),
    referralSignupRewardUsdt: num(
      map.get("referral_signup_reward_usdt"),
      d.referralSignupRewardUsdt,
    ),
    coinToUsdtRate: num(map.get("coin_to_usdt_rate"), d.coinToUsdtRate),
    withdrawalFeeBep20: num(map.get("withdrawal_fee_bep20"), d.withdrawalFeeBep20),
    withdrawalFeeTon: num(map.get("withdrawal_fee_ton"), d.withdrawalFeeTon),
    checkinRewardSchedule: numArray(
      map.get("checkin_reward_schedule"),
      d.checkinRewardSchedule,
    ),
    checkinMultiplierSchedule: numArray(
      map.get("checkin_multiplier_schedule"),
      d.checkinMultiplierSchedule,
    ),
    levelCoinsPerLevel: Math.max(1, num(map.get("level_coins_per_level"), d.levelCoinsPerLevel)),
    trustScoreTaskDelta: num(map.get("trust_score_task_delta"), d.trustScoreTaskDelta),
    trustScoreCheckinDelta: num(map.get("trust_score_checkin_delta"), d.trustScoreCheckinDelta),
    trustScoreCap: num(map.get("trust_score_cap"), d.trustScoreCap),
    trustThresholdForWithdrawal: num(
      map.get("trust_threshold_for_withdrawal"),
      d.trustThresholdForWithdrawal,
    ),
    minWithdrawalUsdt: num(map.get("min_withdrawal_usdt"), d.minWithdrawalUsdt),
    leaderboardSeasonLabel: str(map.get("leaderboard_season_label"), d.leaderboardSeasonLabel),
    leaderboardResetLabel: str(map.get("leaderboard_reset_label"), d.leaderboardResetLabel),
    leaderboardRewardNote: str(map.get("leaderboard_reward_note"), d.leaderboardRewardNote),
    rateLimits: parseRateLimits(map.get("rate_limits")),
  };
}

/**
 * Load settings server-side, with a short-lived in-process cache. Never throws:
 * on any failure it returns the safe defaults so reward routes keep working.
 */
export async function loadSettings(admin: SupabaseClient | null): Promise<Settings> {
  if (!admin) return SETTINGS_DEFAULTS;
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  try {
    const { data, error } = await admin.from("platform_settings").select("key, value");
    if (error) throw error;
    const value = parseSettings((data as Array<{ key: string; value: unknown }>) ?? []);
    cache = { at: now, value };
    return value;
  } catch (err) {
    console.error("[questify] settings load failed", err);
    return cache?.value ?? SETTINGS_DEFAULTS;
  }
}
