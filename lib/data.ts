import { supabase } from "./supabase";
import { authHeaders, getSessionToken } from "./session-client";
import {
  buildSeedActivity,
  SEED_LEADERBOARD,
  SEED_TASKS,
  SEED_TICKER,
} from "./seed";
import type {
  ActivityItem,
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
 * Data access layer. Every function talks to Supabase when it is configured and
 * silently falls back to the bundled seed dataset otherwise. Mutations use
 * `SECURITY DEFINER` Postgres functions (see supabase/schema.sql) so reward
 * math is authoritative on the server.
 */

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!supabase) return fallback;
  try {
    return await fn();
  } catch (err) {
    console.warn("[questify] supabase call failed, using fallback", err);
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
    return (data as Task[]) ?? SEED_TASKS;
  }, SEED_TASKS);
}

export async function fetchUserTasks(userId: string): Promise<UserTask[]> {
  return safe(async () => {
    const { data, error } = await supabase!
      .from("user_tasks")
      .select("*")
      .eq("user_id", userId);
    if (error) throw error;
    return (data as UserTask[]) ?? [];
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
  }, SEED_LEADERBOARD.slice(0, limit));
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
    if (!data?.length) return SEED_TICKER;
    return data.map((row) => {
      const name = (row as { profiles?: { username?: string } }).profiles?.username ?? "user";
      return {
        id: row.id,
        masked_name: `${name.slice(0, 1)}***${name.slice(-1)}`,
        amount_usdt: Number(row.amount_usdt),
        network: row.network as TickerEvent["network"],
        created_at: row.created_at,
      };
    });
  }, SEED_TICKER);
}

export async function fetchActivity(userId: string): Promise<ActivityItem[]> {
  return safe(async () => {
    const [rewards, withdrawals] = await Promise.all([
      supabase!
        .from("user_tasks")
        .select("id, reward_coins, reward_usdt, completed_at, tasks(title, platform)")
        .eq("user_id", userId)
        .eq("status", "completed"),
      supabase!
        .from("withdrawals")
        .select("*")
        .eq("user_id", userId),
    ]);
    if (rewards.error) throw rewards.error;
    if (withdrawals.error) throw withdrawals.error;

    const rewardItems: ActivityItem[] = (rewards.data ?? []).map((row) => ({
      id: row.id,
      type: "reward",
      title: `Task reward · ${(row as { tasks?: { title?: string } }).tasks?.title ?? "Task"}`,
      subtitle: "Task completed",
      amount_coins: row.reward_coins,
      amount_usdt: Number(row.reward_usdt),
      status: "completed",
      created_at: row.completed_at ?? new Date().toISOString(),
    }));

    const withdrawalItems: ActivityItem[] = (withdrawals.data ?? []).map((row) => ({
      id: row.id,
      type: "withdrawal",
      title: `Withdrawal to ${row.network}`,
      subtitle: `${row.address.slice(0, 4)}...${row.address.slice(-4)} · ${row.status}`,
      amount_coins: 0,
      amount_usdt: -Number(row.amount_usdt),
      status: row.status,
      created_at: row.created_at,
    }));

    const all = [...rewardItems, ...withdrawalItems].sort(
      (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
    );
    return all.length ? all : buildSeedActivity(userId);
  }, buildSeedActivity(userId));
}

export async function fetchWallet(userId: string): Promise<Wallet | null> {
  return safe(async () => {
    const { data, error } = await supabase!
      .from("wallets")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data as Wallet) ?? null;
  }, null);
}

export async function fetchCheckins(userId: string): Promise<DailyCheckin[]> {
  return safe(async () => {
    const { data, error } = await supabase!
      .from("daily_checkins")
      .select("*")
      .eq("user_id", userId)
      .order("checked_in_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    return (data as DailyCheckin[]) ?? [];
  }, []);
}

export interface ClaimResult {
  coins: number;
  usdt: number;
  profile?: Profile;
}

/**
 * Call the authenticated reward endpoint. Returns `fallback` when there is no
 * session token (offline/demo) or the request fails, so callers can degrade
 * gracefully without ever trusting unverified client state.
 */
async function postReward<T>(body: Record<string, unknown>, fallback: T): Promise<T> {
  const token = getSessionToken();
  if (!token) return fallback;
  try {
    const res = await fetch("/api/rewards", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "reward_failed");
    return (json.data ?? fallback) as T;
  } catch (err) {
    console.warn("[questify] reward call failed, using fallback", err);
    return fallback;
  }
}

export async function rpcClaimTask(taskId: string): Promise<ClaimResult | null> {
  return postReward<ClaimResult | null>({ action: "claim_task", taskId }, null);
}

export async function rpcClaimCheckin(): Promise<ClaimResult | null> {
  return postReward<ClaimResult | null>({ action: "claim_checkin" }, null);
}

export async function rpcApplyReferral(code: string): Promise<boolean> {
  return postReward<boolean>({ action: "apply_referral", code }, false);
}

export async function rpcWithdraw(
  amount: number,
  network: Withdrawal["network"],
  address: string,
): Promise<Withdrawal | null> {
  return postReward<Withdrawal | null>(
    { action: "withdraw", amount, network, address },
    null,
  );
}

export async function saveWallet(patch: Partial<Wallet>): Promise<boolean> {
  return postReward<boolean>({ action: "save_wallet", wallet: patch }, false);
}
