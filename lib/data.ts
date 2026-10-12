import { supabase } from "./supabase";
import { authHeaders, getSessionToken } from "./session-client";
import { envConfig, type PublicConfig } from "./config";
import type {
  ActivityItem,
  ConnectedAccount,
  DailyCheckin,
  LeaderboardEntry,
  Profile,
  Task,
  TickerEvent,
  UserTask,
  Wallet,
  Withdrawal,
} from "./types";

/**
 * Data access layer.
 *
 * Public reads (tasks, leaderboard, payout ticker, runtime config) use the anon
 * Supabase client under RLS. Everything user-scoped goes through authenticated
 * Next.js routes (`/api/me`, `/api/rewards`) which execute with the service role:
 * the browser never holds a Supabase Auth session, so `auth.uid()` is null and
 * RLS would otherwise hide the caller's own rows. Mutations use
 * `SECURITY DEFINER` Postgres functions so reward math is authoritative.
 */

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!supabase) return fallback;
  try {
    return await fn();
  } catch (err) {
    console.warn("[questify] supabase read failed", err);
    return fallback;
  }
}

export async function fetchTasks(): Promise<Task[]> {
  return safe(async () => {
    const { data, error } = await supabase!
      .from("tasks")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as Task[]) ?? [];
  }, []);
}

export async function fetchLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  return safe(async () => {
    // Read from the column-limited public view, never the raw profiles table
    // (which is locked down to self-only under RLS).
    const { data, error } = await supabase!
      .from("public_profiles")
      .select("id, username, photo_url, level, usdt_balance, referral_count")
      .order("usdt_balance", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row, i) => ({
      id: row.id,
      username: row.username ?? "anon",
      photo_url: row.photo_url,
      level: row.level,
      usdt_earned: Number(row.usdt_balance),
      referrals: row.referral_count ?? 0,
      rank: i + 1,
    }));
  }, []);
}

export async function fetchTicker(limit = 20): Promise<TickerEvent[]> {
  return safe(async () => {
    const { data, error } = await supabase!
      .from("withdrawals")
      .select("id, amount_usdt, network, created_at, profiles!inner(username)")
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => {
      const name = (row as { profiles?: { username?: string } }).profiles?.username ?? "user";
      return {
        id: row.id,
        masked_name: `${name.slice(0, 1)}***${name.slice(-1)}`,
        amount_usdt: Number(row.amount_usdt),
        network: row.network as TickerEvent["network"],
        created_at: row.created_at,
      };
    });
  }, []);
}

/** Runtime brand/bot config (platform_settings overrides env defaults). */
export async function fetchRuntimeConfig(): Promise<PublicConfig> {
  try {
    const res = await fetch("/api/config");
    const json = (await res.json()) as { ok: boolean; data?: PublicConfig };
    return json.ok && json.data ? json.data : envConfig();
  } catch {
    return envConfig();
  }
}

export interface MeData {
  profile: Profile | null;
  wallet: Wallet | null;
  userTasks: UserTask[];
  checkins: DailyCheckin[];
  activity: ActivityItem[];
  connectedAccounts: ConnectedAccount[];
}

const EMPTY_ME: MeData = {
  profile: null,
  wallet: null,
  userTasks: [],
  checkins: [],
  activity: [],
  connectedAccounts: [],
};

/**
 * Fetch everything scoped to the authenticated user (profile, wallet, task
 * completions, check-ins, activity feed and linked accounts) through the
 * service-role `/api/me` route. Returns `null` when there is no session.
 */
export async function fetchMe(): Promise<MeData | null> {
  const token = getSessionToken();
  if (!token) return null;
  try {
    const res = await fetch("/api/me", { headers: { ...authHeaders() } });
    const json = (await res.json()) as { ok?: boolean; data?: MeData };
    if (!res.ok || !json.ok || !json.data) return null;
    return { ...EMPTY_ME, ...json.data };
  } catch (err) {
    console.warn("[questify] me fetch failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mutations (authenticated reward endpoint)
// ---------------------------------------------------------------------------

export interface ClaimResult {
  coins: number;
  usdt: number;
  profile?: Profile;
}

export interface StartTaskResult {
  submitted_at: string;
  min_seconds: number;
  verification_type?: string | null;
}

/** Error thrown for any failed/unauthorized reward call. */
export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function rewardErrorMessage(code?: string): string {
  switch (code) {
    case "not_authenticated":
    case "not authenticated":
    case "unauthorized":
      return "Your session expired — please reopen the app";
    case "not_configured":
      return "Rewards are temporarily unavailable";
    case "invalid_json":
    case "invalid_body":
      return "Something went wrong. Please try again";
    case "task already completed":
      return "You already completed this task";
    case "task not found or inactive":
      return "This task is no longer available";
    case "verification in progress":
      return "Verification still in progress — please wait for the timer";
    case "not_member":
      return "You haven't joined yet — complete the action, then try again";
    case "account_not_linked":
      return "Link the required account first, then try again";
    case "unsupported_verification":
    case "task_misconfigured":
    case "verification_failed":
    case "verification_error":
      return "We couldn't verify this task. Please try again later";
    case "already checked in today":
      return "You already claimed today's check-in";
    case "insufficient balance":
      return "Insufficient balance";
    case "trust score too low":
      return "Your trust score is too low to withdraw";
    case "account suspended":
      return "Your account is suspended";
    default:
      return code && !code.includes("_") ? code : "Something went wrong. Please try again";
  }
}

async function postReward<T>(body: Record<string, unknown>): Promise<T> {
  const token = getSessionToken();
  if (!token) throw new ApiError("Your session expired — please reopen the app");

  let res: Response;
  try {
    res = await fetch("/api/rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Network error — please check your connection and try again");
  }

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: T;
    error?: string;
  };
  if (!res.ok || !json.ok) throw new ApiError(rewardErrorMessage(json.error));
  return json.data as T;
}

/** Mark a task as "started" server-side; required before `rpcClaimTask`. */
export async function rpcStartTask(taskId: string): Promise<StartTaskResult> {
  return postReward<StartTaskResult>({ action: "start_task", taskId });
}

export async function rpcClaimTask(taskId: string): Promise<ClaimResult> {
  return postReward<ClaimResult>({ action: "claim_task", taskId });
}

export async function rpcClaimCheckin(): Promise<ClaimResult> {
  return postReward<ClaimResult>({ action: "claim_checkin" });
}

export async function rpcApplyReferral(code: string): Promise<boolean> {
  return postReward<boolean>({ action: "apply_referral", code });
}

export async function rpcWithdraw(
  amount: number,
  network: Withdrawal["network"],
  address: string,
): Promise<Withdrawal> {
  return postReward<Withdrawal>({ action: "withdraw", amount, network, address });
}

export async function saveWallet(patch: Partial<Wallet>): Promise<boolean> {
  return postReward<boolean>({ action: "save_wallet", wallet: patch });
}
