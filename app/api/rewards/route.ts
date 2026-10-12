import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { verifyTask, type VerifiableTask } from "@/lib/verification";
import {
  isNetwork,
  isUuid,
  isValidAddress,
  isValidAmount,
  isValidReferralCode,
} from "@/lib/validation";

interface RewardsBody {
  action?:
    | "start_task"
    | "claim_task"
    | "claim_checkin"
    | "withdraw"
    | "apply_referral"
    | "save_wallet";
  taskId?: string;
  amount?: number;
  network?: string;
  address?: string;
  code?: string;
  wallet?: { usdt_bep20?: string | null; ton_address?: string | null };
}

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Authenticated mutation endpoint. Strictly verifies the Questify session token
 * AND (in production) the Telegram `initData` HMAC signature, then runs the
 * authoritative SECURITY DEFINER reward functions with the service role. All
 * client input is validated before it reaches the database, and the verified
 * user id is passed explicitly — the browser can never act as another user.
 */
export async function POST(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.ok) return auth.response;

  const admin = getSupabaseAdmin();
  if (!admin) return fail("not_configured", 503);

  let body: RewardsBody;
  try {
    body = (await request.json()) as RewardsBody;
  } catch {
    return fail("invalid_json", 400);
  }
  if (!body || typeof body !== "object") return fail("invalid_body", 400);

  const userId = auth.context.userId;
  const telegramId = auth.context.telegramId;

  try {
    switch (body.action) {
      case "start_task": {
        if (!isUuid(body.taskId)) return fail("invalid_task", 400);
        const { data, error } = await admin.rpc("start_task", {
          p_task_id: body.taskId,
          p_user: userId,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }

      case "claim_task": {
        if (!isUuid(body.taskId)) return fail("invalid_task", 400);

        // Load the task's verification configuration, then verify it server-side
        // BEFORE crediting. The duration gate itself runs atomically inside the
        // claim_task RPC on the database clock.
        const { data: task, error: taskError } = await admin
          .from("tasks")
          .select("id, platform, verification_type, verification_target, verification_rules, is_active")
          .eq("id", body.taskId)
          .maybeSingle();
        if (taskError) throw taskError;
        if (!task || !(task as { is_active?: boolean }).is_active) {
          return fail("task not found or inactive", 400);
        }

        const verdict = await verifyTask({
          task: task as VerifiableTask,
          userId,
          telegramId,
          admin,
        });
        if (!verdict.ok) return fail(verdict.reason ?? "verification_failed", 403);

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
        if (!isValidAmount(body.amount)) return fail("invalid_amount", 400);
        if (!isNetwork(body.network)) return fail("invalid_network", 400);
        if (!isValidAddress(body.network, body.address)) return fail("invalid_address", 400);
        const { data, error } = await admin.rpc("request_withdrawal", {
          p_amount: body.amount,
          p_network: body.network,
          p_address: body.address.trim(),
          p_user: userId,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }

      case "apply_referral": {
        if (!isValidReferralCode(body.code)) return fail("invalid_code", 400);
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
          const value = body.wallet.usdt_bep20;
          if (value !== null && value !== undefined && value !== "") {
            if (!isValidAddress("BEP20", value)) return fail("invalid_bep20_address", 400);
            patch.usdt_bep20 = value.trim();
          } else {
            patch.usdt_bep20 = null;
          }
        }
        if (body.wallet && "ton_address" in body.wallet) {
          const value = body.wallet.ton_address;
          if (value !== null && value !== undefined && value !== "") {
            if (!isValidAddress("TON", value)) return fail("invalid_ton_address", 400);
            patch.ton_address = value.trim();
          } else {
            patch.ton_address = null;
          }
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
