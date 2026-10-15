import { NextResponse } from "next/server";
import { authenticateMcc } from "@/lib/mcc-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Cookie-gated "live numbers" endpoint for the control center.
 *
 * The browser learns *when* something happened from the public
 * `mcc_live_ticks` heartbeat (only a source name + timestamp, no money, no
 * ids) and then fetches the REAL numbers here — so ledger and withdrawal rows
 * never need to be readable through the anon key. Deliberately narrow: counts,
 * paid totals and both wallet balances. No polling: the client refetches on
 * mount, on heartbeat events and on window focus.
 */
export interface MccLivePayload {
  stats: {
    totalUsers: number;
    totalTasksCompleted: number;
    pendingWithdrawals: number;
    totalPaidOut: number;
  };
  wallets: { owner: number; marketing: number };
  ticks: Record<string, string>;
}

export async function GET(request: Request) {
  const auth = await authenticateMcc(request);
  if (!auth.ok) return auth.response;

  const admin = getSupabaseAdmin();
  if (!admin) return fail(503, "not_configured");

  try {
    const [totalUsers, totalTasksCompleted, pendingWithdrawals, payouts, ownerBalance, marketingBalance, ticks] =
      await Promise.all([
        admin.from("profiles").select("*", { count: "exact", head: true }),
        admin
          .from("user_tasks")
          .select("*", { count: "exact", head: true })
          .eq("status", "completed"),
        admin
          .from("withdrawals")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        admin.from("withdrawals").select("amount_usdt").eq("status", "paid"),
        admin.rpc("owner_wallet_balance"),
        admin.rpc("marketing_wallet_balance"),
        admin.from("mcc_live_ticks").select("source, at"),
      ]);

    const totalPaid = (payouts.data ?? []).reduce(
      (sum, row) => sum + Number((row as { amount_usdt?: number }).amount_usdt || 0),
      0,
    );

    const tickMap: Record<string, string> = {};
    for (const row of ticks.data ?? []) {
      const r = row as { source: string; at: string };
      if (r?.source && r?.at) tickMap[r.source] = r.at;
    }

    const payload: MccLivePayload = {
      stats: {
        totalUsers: totalUsers.count ?? 0,
        totalTasksCompleted: totalTasksCompleted.count ?? 0,
        pendingWithdrawals: pendingWithdrawals.count ?? 0,
        totalPaidOut: totalPaid,
      },
      wallets: {
        owner: Number(ownerBalance.data ?? 0) || 0,
        marketing: Number(marketingBalance.data ?? 0) || 0,
      },
      ticks: tickMap,
    };

    return NextResponse.json(
      { ok: true, data: payload },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[questify] mcc live error", err);
    return fail(500, "failed");
  }
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}
