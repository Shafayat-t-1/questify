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
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { invalidateSettingsCache } from "@/lib/settings";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BROADCAST_BATCH = 150;

/** Business `platform_settings` keys the admin panel may edit, with bounds. */
const NUMERIC_SETTINGS: Record<string, { min: number; max: number }> = {
  referral_commission_pct: { min: 0, max: 1 },
  referral_signup_reward_coins: { min: 0, max: 10_000_000 },
  referral_signup_reward_usdt: { min: 0, max: 10_000 },
  coin_to_usdt_rate: { min: 0, max: 1000 },
  withdrawal_fee_bep20: { min: 0, max: 10_000 },
  withdrawal_fee_ton: { min: 0, max: 10_000 },
  level_coins_per_level: { min: 1, max: 10_000_000 },
  trust_score_task_delta: { min: 0, max: 100 },
  trust_score_checkin_delta: { min: 0, max: 100 },
  trust_score_cap: { min: 1, max: 10_000 },
  trust_threshold_for_withdrawal: { min: 0, max: 10_000 },
  min_withdrawal_usdt: { min: 0, max: 1_000_000 },
};
const NUMBER_ARRAY_SETTINGS = new Set(["checkin_reward_schedule", "checkin_multiplier_schedule"]);
const STRING_SETTINGS = new Set([
  "leaderboard_season_label",
  "leaderboard_reset_label",
  "leaderboard_reward_note",
]);

/** Validate an incoming admin setting value; returns the JSON value or null. */
function sanitizeSetting(key: unknown, value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof key !== "string") return { ok: false };

  if (key === "rate_limits") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
    return { ok: true, value };
  }

  const bounds = NUMERIC_SETTINGS[key];
  if (bounds) {
    const n = boundedNumber(value, bounds.min, bounds.max);
    return n === null ? { ok: false } : { ok: true, value: n };
  }

  if (NUMBER_ARRAY_SETTINGS.has(key)) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 31) return { ok: false };
    const arr = value.map((v) => boundedNumber(v, 0, 10_000_000));
    return arr.some((v) => v === null) ? { ok: false } : { ok: true, value: arr };
  }

  if (STRING_SETTINGS.has(key)) {
    const s = boundedString(value, 120);
    return s === null ? { ok: false } : { ok: true, value: s };
  }

  return { ok: false };
}

/** Send one Telegram message; returns true on success. */
async function sendTelegram(chatId: number | string, text: string): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

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
    const [users, tasks, withdrawals, actions, settings] = await Promise.all([
      admin.from("profiles").select("*").order("created_at", { ascending: false }).limit(100),
      admin.from("tasks").select("*").order("created_at", { ascending: false }),
      admin!
        .from("withdrawals")
        .select("*, profiles!withdrawals_user_id_fkey(username, telegram_id)")
        .order("created_at", { ascending: false }),
      admin.from("admin_actions").select("*").order("created_at", { ascending: false }).limit(50),
      admin.from("platform_settings").select("key, value, is_public, description").order("key"),
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
        settings: settings.data || [],
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
        const txHash = boundedString(params.tx_hash, 128);
        // A paid withdrawal must carry the on-chain proof of broadcast.
        if (params.status === "paid" && !txHash) return fail("tx_hash_required", 400);
        const { data, error } = await admin.rpc("admin_update_withdrawal", {
          p_admin: adminId,
          p_withdrawal_id: params.withdrawalId,
          p_status: params.status,
          p_tx_hash: txHash,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }

      case "update_settings": {
        const settingKey = typeof params.key === "string" ? params.key : "";
        const sanitized = sanitizeSetting(settingKey, params.value);
        if (!sanitized.ok) return fail("invalid_setting", 400);
        const { data, error } = await admin.rpc("admin_set_setting", {
          p_admin: adminId,
          p_key: settingKey,
          p_value: sanitized.value,
        });
        if (error) throw error;
        invalidateSettingsCache();
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

      case "lookup_user": {
        const query = typeof params.query === "string" ? params.query.slice(0, 64) : null;
        const { data, error } = await admin.rpc("admin_search_users", {
          p_admin: adminId,
          p_query: query,
          p_limit: boundedInt(params.limit, 1, 100) ?? 25,
          p_offset: boundedInt(params.offset, 0, 1_000_000) ?? 0,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }

      case "adjust_balance": {
        if (!isUuid(params.userId)) return fail("invalid_user_id", 400);
        const deltaCoins = boundedInt(params.delta_coins, -1_000_000_000, 1_000_000_000) ?? 0;
        const deltaUsdt = boundedNumber(params.delta_usdt, -1_000_000, 1_000_000) ?? 0;
        if (deltaCoins === 0 && deltaUsdt === 0) return fail("empty_adjustment", 400);
        const reason = boundedString(params.reason, 200) ?? "manual adjustment";
        const { data, error } = await admin.rpc("admin_adjust_balance", {
          p_admin: adminId,
          p_user_id: params.userId,
          p_delta_coins: deltaCoins,
          p_delta_usdt: deltaUsdt,
          p_reason: reason,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, data });
      }

      case "broadcast": {
        const message = boundedString(params.message, 4000);
        if (!message) return fail("invalid_message", 400);
        const offset = boundedInt(params.offset, 0, 100_000_000) ?? 0;
        // A broadcast is paginated: only the first page counts as one hit, so a
        // legit large send is not cut off mid-way by the per-minute window.
        if (offset === 0) {
          const limited = await checkRateLimit(admin, "broadcast", adminId);
          if (!limited.allowed) return rateLimitedResponse(limited);
        }

        const { data: recipients, error } = await admin
          .from("profiles")
          .select("telegram_id")
          .eq("is_banned", false)
          .order("created_at", { ascending: true })
          .range(offset, offset + BROADCAST_BATCH - 1);
        if (error) throw error;

        const ids = (recipients ?? [])
          .map((r) => (r as { telegram_id: number | string }).telegram_id)
          .filter((id) => id !== undefined && id !== null);

        let sent = 0;
        const CONCURRENCY = 20;
        for (let i = 0; i < ids.length; i += CONCURRENCY) {
          const slice = ids.slice(i, i + CONCURRENCY);
          const results = await Promise.all(slice.map((id) => sendTelegram(id, message)));
          sent += results.filter(Boolean).length;
        }

        const processed = ids.length;
        const nextOffset = offset + processed;
        const done = processed < BROADCAST_BATCH;

        return NextResponse.json({
          ok: true,
          data: { processed, sent, failed: processed - sent, nextOffset, done },
        });
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
