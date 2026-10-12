/**
 * Progressive 7-day streak schedule (coins + multiplier). Mirrors the
 * `v_rewards` array in `claim_daily_checkin` (supabase/schema.sql) so the UI and
 * the server agree on each day's reward.
 */
export const CHECKIN_SCHEDULE = [
  { day: 1, coins: 100, multiplier: 1.0 },
  { day: 2, coins: 150, multiplier: 1.1 },
  { day: 3, coins: 220, multiplier: 1.2 },
  { day: 4, coins: 320, multiplier: 1.4 },
  { day: 5, coins: 450, multiplier: 1.6 },
  { day: 6, coins: 600, multiplier: 1.8 },
  { day: 7, coins: 1000, multiplier: 2.5 },
] as const;
