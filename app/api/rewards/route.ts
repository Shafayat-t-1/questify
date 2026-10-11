import { NextResponse } from "next/server";
import { bearerToken, verifySessionToken } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

interface RewardsBody {
  action?: "claim_task" | "claim_checkin" | "withdraw" | "apply_referral" | "save_wallet";
  taskId?: string;
  amount?: number;
  network?: "BEP20" | "TON";
  address?: string;
  code?: string;
  wallet?: { usdt_bep20?: string | null; ton_address?: string | null };
}

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Authenticated mutation endpoint. Verifies the Questify session token, then
 * runs the authoritative SECURITY DEFINER reward functions with the service
 * role (passing the verified user id explicitly). This keeps all reward math
 * server-side and never exposes the service key to the browser.
 */
export async function POST(request: Request) {
  const session = verifySessionToken(bearerToken(request));
  if (!session) return fail("unauthorized", 401);

  const admin = getSupabaseAdmin();
  if (!admin) return fail("not_configured", 503);

  let body: RewardsBody;
  try {
    body = (await request.json()) as RewardsBody;
  } catch {
    return fail("invalid_json", 400);
  }

  const userId = session.sub;

  try {
    switch (body.action) {
      case "claim_task": {
        if (!body.taskId) return fail("missing_task", 400);
        const { data, error } = await admin.rpc("claim_task", {
          p_task_id: body.taskId,
          p_user: userId,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }

      case "claim_checkin": {
        const { data, error } = await admin.rpc("claim_daily_checkin", {
          p_user: userId,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }

      case "withdraw": {
        if (!body.amount || !body.network || !body.address) {
          return fail("missing_withdrawal_fields", 400);
        }
        const { data, error } = await admin.rpc("request_withdrawal", {
          p_amount: body.amount,
          p_network: body.network,
          p_address: body.address,
          p_user: userId,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }

      case "apply_referral": {
        if (!body.code) return fail("missing_code", 400);
        const { data, error } = await admin.rpc("apply_referral", {
          p_code: body.code,
          p_user: userId,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data: Boolean(data) });
      }

      case "save_wallet": {
        const patch: Record<string, string | null> = {};
        if (body.wallet && "usdt_bep20" in body.wallet) {
          patch.usdt_bep20 = body.wallet.usdt_bep20 ?? null;
        }
        if (body.wallet && "ton_address" in body.wallet) {
          patch.ton_address = body.wallet.ton_address ?? null;
        }
        if (Object.keys(patch).length === 0) return fail("empty_wallet_patch", 400);
        const { error } = await admin
          .from("wallets")
          .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
        if (error) throw error;
        return NextResponse.json({ ok: true, data: true });
      }

      default:
        return fail("unknown_action", 400);
    }
  } catch (err) {
    console.error("[questify] reward action failed", err);
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "reward_failed";
    return fail(message, 400);
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "questify-rewards",
    configured: Boolean(getSupabaseAdmin()),
  });
}
