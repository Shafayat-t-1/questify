/**
 * Default 7-day streak schedule (coins + multiplier). These are the fallback
 * values; the live schedule is served from `platform_settings`
 * (`checkin_reward_schedule` / `checkin_multiplier_schedule`) via `/api/config`
 * so the operator can retune it without a redeploy.
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

export interface CheckinDay {
  day: number;
  coins: number;
  multiplier: number;
}

/**
 * Build the schedule shown in the UI from the admin-configured reward/multiplier
 * arrays. Falls back to the compiled-in defaults when arrays are missing/empty.
 */
export function buildCheckinSchedule(
  rewards?: number[] | null,
  multipliers?: number[] | null,
): CheckinDay[] {
  if (!rewards || rewards.length === 0) return CHECKIN_SCHEDULE.map((d) => ({ ...d }));
  return rewards.map((coins, i) => ({
    day: i + 1,
    coins,
    multiplier: multipliers?.[i] ?? 1,
  }));
}
