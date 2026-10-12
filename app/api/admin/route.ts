import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateRequest } from "@/lib/api-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  boundedInt,
  boundedNumber,
  boundedString,
  isUuid,
  isWithdrawalStatus,
  validHttpUrl,
} from "@/lib/validation";

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

type AdminGate =
  | { error: NextResponse }
  | { admin: SupabaseClient; adminId: string };

/** Authenticate the session (HMAC-verified) and confirm the caller is admin. */
async function requireAdmin(request: Request): Promise<AdminGate> {
  const auth = authenticateRequest(request);
  if (!auth.ok) return { error: auth.response };

  const admin = getSupabaseAdmin();
  if (!admin) return { error: fail("not_configured", 503) };

  const { data: me } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", auth.context.userId)
    .maybeSingle();
  if (!me?.is_admin) return { error: fail("forbidden", 403) };

  return { admin, adminId: auth.context.userId };
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  try {
    const [users, tasks, withdrawals, actions] = await Promise.all([
      admin.from("profiles").select("*").order("created_at", { ascending: false }).limit(100),
      admin.from("tasks").select("*").order("created_at", { ascending: false }),
      admin!
        .from("withdrawals")
        .select("*, profiles!withdrawals_user_id_fkey(username, telegram_id)")
        .order("created_at", { ascending: false }),
      admin.from("admin_actions").select("*").order("created_at", { ascending: false }).limit(50),
    ]);

    const { count: totalUsers } = await admin!
      .from("profiles")
      .select("*", { count: "exact", head: true });
    const { count: totalTasksCompleted } = await admin!
      .from("user_tasks")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed");
    const { count: pendingWithdrawals } = await admin!
      .from("withdrawals")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    const { data: payouts } = await admin!
      .from("withdrawals")
      .select("amount_usdt")
      .eq("status", "paid");
    const totalPaid = (payouts || []).reduce(
      (sum: number, w: Record<string, unknown>) => sum + Number(w.amount_usdt || 0),
      0,
    );

    return NextResponse.json({
      ok: true,
      data: {
        stats: {
          totalUsers: totalUsers || 0,
          totalTasksCompleted: totalTasksCompleted || 0,
          pendingWithdrawals: pendingWithdrawals || 0,
          totalPaidOut: totalPaid,
          totalActiveUsers: totalUsers || 0,
          platformLiquidity: totalPaid,
        },
        users: users.data || [],
        tasks: tasks.data || [],
        withdrawals: withdrawals.data || [],
        actions: actions.data || [],
      },
    });
  } catch (err) {
    console.error("[questify] admin get error", err);
    return fail("failed", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin, adminId } = auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail("invalid_json", 400);
  }
  if (!body || typeof body !== "object") return fail("invalid_body", 400);

  const action = body.action;
  const params = body;

  try {
    switch (action) {
      case "upsert_task": {
        const taskId = params.p_task_id ? (isUuid(params.p_task_id) ? params.p_task_id : null) : null;
        if (params.p_task_id && !taskId) return fail("invalid_task_id", 400);
        const { data, error } = await admin.rpc("admin_upsert_task", {
          p_admin: adminId,
          p_task_id: taskId,
          p_title: boundedString(params.title, 120),
          p_description: boundedString(params.description, 2000),
          p_platform: boundedString(params.platform, 40),
          p_action_label: boundedString(params.action_label, 60),
          p_action_url: params.action_url ? validHttpUrl(params.action_url) : null,
          p_reward_coins: boundedInt(params.reward_coins, 0, 1_000_000),
          p_reward_usdt: boundedNumber(params.reward_usdt, 0, 100_000),
          p_difficulty: boundedString(params.difficulty, 20),
          p_duration_seconds: boundedInt(params.duration_seconds, 0, 86_400),
          p_is_active: typeof params.is_active === "boolean" ? params.is_active : null,
          p_verification_type: boundedString(params.verification_type, 40),
          p_verification_target: boundedString(params.verification_target, 200),
          p_verification_rules:
            params.verification_rules && typeof params.verification_rules === "object"
              ? params.verification_rules
              : null,
          p_max_completions: boundedInt(params.max_completions, 0, 10_000_000),
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }

      case "delete_task": {
        if (!isUuid(params.taskId)) return fail("invalid_task_id", 400);
        const { data, error } = await admin.rpc("admin_delete_task", {
          p_admin: adminId,
          p_task_id: params.taskId,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }

      case "update_withdrawal": {
        if (!isUuid(params.withdrawalId)) return fail("invalid_withdrawal_id", 400);
        if (!isWithdrawalStatus(params.status)) return fail("invalid_status", 400);
        const { data, error } = await admin.rpc("admin_update_withdrawal", {
          p_admin: adminId,
          p_withdrawal_id: params.withdrawalId,
          p_status: params.status,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }

      case "update_user": {
        if (!isUuid(params.userId)) return fail("invalid_user_id", 400);
        const { data, error } = await admin.rpc("admin_update_user", {
          p_admin: adminId,
          p_user_id: params.userId,
          p_is_banned: typeof params.is_banned === "boolean" ? params.is_banned : null,
          p_is_admin: typeof params.is_admin === "boolean" ? params.is_admin : null,
          p_trust_score: boundedInt(params.trust_score, 0, 100),
          p_coins: boundedInt(params.coins, 0, 1_000_000_000),
          p_usdt_balance: boundedNumber(params.usdt_balance, 0, 1_000_000),
          p_referral_count: boundedInt(params.referral_count, 0, 1_000_000),
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }

      default:
        return fail("unknown_action", 400);
    }
  } catch (err: unknown) {
    console.error("[questify] admin action failed", err);
    const msg = err instanceof Error ? err.message : "failed";
    return fail(msg, 400);
  }
}
