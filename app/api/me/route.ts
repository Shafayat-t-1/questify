import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { ActivityItem, ConnectedAccount, Profile, Wallet } from "@/lib/types";

/**
 * Returns everything scoped to the authenticated user through the service role.
 *
 * The browser talks to Supabase with the anon key and holds no Supabase Auth
 * session, so `auth.uid()` is null and RLS hides the caller's own rows. Routing
 * these reads through this authenticated, service-role handler keeps the data
 * private (strict session + initData verification in `authenticateRequest`)
 * while remaining correct.
 */
export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.ok) return auth.response;

  const admin = getSupabaseAdmin();
  const userId = auth.context.userId;

  if (!admin) {
    return NextResponse.json({
      ok: true,
      data: {
        profile: null,
        wallet: null,
        userTasks: [],
        checkins: [],
        activity: [],
        connectedAccounts: [],
      },
    });
  }

  try {
    const [profileRes, walletRes, userTasksRes, checkinsRes, rewardsRes, withdrawalsRes, accountsRes] =
      await Promise.all([
        admin.from("profiles").select("*").eq("id", userId).maybeSingle(),
        admin.from("wallets").select("*").eq("user_id", userId).maybeSingle(),
        admin.from("user_tasks").select("*").eq("user_id", userId),
        admin
          .from("daily_checkins")
          .select("*")
          .eq("user_id", userId)
          .order("checked_in_at", { ascending: false })
          .limit(30),
        admin
          .from("user_tasks")
          .select("id, reward_coins, reward_usdt, completed_at, tasks(title)")
          .eq("user_id", userId)
          .eq("status", "completed"),
        admin.from("withdrawals").select("*").eq("user_id", userId),
        admin
          .from("connected_accounts")
          .select("provider, provider_user_id, username, connected_at")
          .eq("user_id", userId)
          .order("connected_at", { ascending: false }),
      ]);

    const firstError = [
      profileRes.error,
      walletRes.error,
      userTasksRes.error,
      checkinsRes.error,
      rewardsRes.error,
      withdrawalsRes.error,
      accountsRes.error,
    ].find(Boolean);
    if (firstError) throw firstError;

    const rewardItems: ActivityItem[] = (rewardsRes.data ?? []).map((row) => ({
      id: row.id,
      type: "reward",
      title: `Task reward · ${(row as { tasks?: { title?: string } }).tasks?.title ?? "Task"}`,
      subtitle: "Task completed",
      amount_coins: row.reward_coins,
      amount_usdt: Number(row.reward_usdt),
      status: "completed",
      created_at: row.completed_at ?? new Date().toISOString(),
    }));

    const withdrawalItems: ActivityItem[] = (withdrawalsRes.data ?? []).map((row) => ({
      id: row.id,
      type: "withdrawal",
      title: `Withdrawal to ${row.network}`,
      subtitle: `${row.address.slice(0, 4)}...${row.address.slice(-4)} · ${row.status}`,
      amount_coins: 0,
      amount_usdt: -Number(row.amount_usdt),
      status: row.status,
      created_at: row.created_at,
    }));

    const activity = [...rewardItems, ...withdrawalItems].sort(
      (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
    );

    return NextResponse.json({
      ok: true,
      data: {
        profile: (profileRes.data as Profile) ?? null,
        wallet: (walletRes.data as Wallet) ?? null,
        userTasks: userTasksRes.data ?? [],
        checkins: checkinsRes.data ?? [],
        activity,
        connectedAccounts: (accountsRes.data as ConnectedAccount[]) ?? [],
      },
    });
  } catch (err) {
    console.error("[questify] me error", err);
    return NextResponse.json({ ok: false, error: "me_failed" }, { status: 500 });
  }
}
