import { NextResponse } from "next/server";
import { bearerToken, verifySessionToken } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(request: Request) {
  const session = verifySessionToken(bearerToken(request));
  if (!session) return fail("unauthorized", 401);

  const admin = getSupabaseAdmin();
  if (!admin) return fail("not_configured", 503);

  const { data: me } = await admin.from("profiles").select("is_admin, id").eq("id", session.sub).maybeSingle();
  if (!me?.is_admin) return fail("forbidden", 403);

  try {
    const [users, tasks, withdrawals, actions] = await Promise.all([
      admin.from("profiles").select("*").order("created_at", { ascending: false }).limit(100),
      admin.from("tasks").select("*").order("created_at", { ascending: false }),
      admin.from("withdrawals").select("*, profiles!withdrawals_user_id_fkey(username, telegram_id)").order("created_at", { ascending: false }),
      admin.from("admin_actions").select("*").order("created_at", { ascending: false }).limit(50),
    ]);

    const { count: totalUsers } = await admin.from("profiles").select("*", { count: "exact", head: true });
    const { count: totalTasksCompleted } = await admin.from("user_tasks").select("*", { count: "exact", head: true }).eq("status", "completed");
    const { count: pendingWithdrawals } = await admin.from("withdrawals").select("*", { count: "exact", head: true }).eq("status", "pending");
    const { data: payouts } = await admin.from("withdrawals").select("amount_usdt").eq("status", "paid");
    const totalPaid = (payouts || []).reduce((sum: number, w: Record<string, unknown>) => sum + Number(w.amount_usdt || 0), 0);

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
  const session = verifySessionToken(bearerToken(request));
  if (!session) return fail("unauthorized", 401);

  const admin = getSupabaseAdmin();
  if (!admin) return fail("not_configured", 503);

  const { data: me } = await admin.from("profiles").select("is_admin").eq("id", session.sub).maybeSingle();
  if (!me?.is_admin) return fail("forbidden", 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return fail("invalid_json", 400);
  }

  const { action, ...params } = body;

  try {
    switch (action) {
      case "upsert_task": {
        const { data, error } = await admin.rpc("admin_upsert_task", { p_admin: session.sub, ...params });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }
      case "delete_task": {
        const { data, error } = await admin.rpc("admin_delete_task", { p_admin: session.sub, p_task_id: params.taskId });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }
      case "update_withdrawal": {
        const { data, error } = await admin.rpc("admin_update_withdrawal", {
          p_admin: session.sub,
          p_withdrawal_id: params.withdrawalId,
          p_status: params.status,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }
      case "update_user": {
        const { data, error } = await admin.rpc("admin_update_user", {
          p_admin: session.sub,
          p_user_id: params.userId,
          ...params,
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
