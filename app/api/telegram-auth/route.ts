import { NextResponse } from "next/server";
import { signSession } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { verifyTelegramInitData, type TelegramUser } from "@/lib/telegram-auth";
import { processReferral, type ReferralEventRecord, type ReferralRepo } from "@/lib/referral-server";
import type { Profile, Wallet } from "@/lib/types";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Sandbox/demo sessions are opt-in and STRICTLY non-production. They are only
 * ever reachable behind a verified bot token; there is no unverified path.
 */
const DEMO_MODE = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";

interface AuthBody {
  initData?: string;
  referralCode?: string;
}

// Sandbox profiles start empty — no mock balances, ever.
const DEMO_COINS = 0;
const DEMO_USDT = 0;

function demoProfile(telegram: TelegramUser): Profile {
  const nowIso = new Date().toISOString();
  const username = telegram.username ?? `user${telegram.id}`;
  return {
    id: `demo-${telegram.id}`,
    telegram_id: telegram.id,
    username,
    first_name: telegram.first_name ?? "Questify",
    last_name: telegram.last_name ?? "User",
    photo_url: telegram.photo_url ?? null,
    language_code: telegram.language_code ?? "en",
    coins: DEMO_COINS,
    usdt_balance: DEMO_USDT,
    trust_score: 50,
    level: 1,
    referral_code: username.slice(0, 6).toUpperCase().padEnd(8, "X"),
    referred_by: null,
    referral_count: 0,
    is_premium: telegram.is_premium ?? false,
    is_banned: false,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function demoWallet(userId: string): Wallet {
  const nowIso = new Date().toISOString();
  return {
    id: `wallet-${userId}`,
    user_id: userId,
    usdt_bep20: null,
    ton_address: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

export async function POST(request: Request) {
  let body: AuthBody;
  try {
    body = (await request.json()) as AuthBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const initData = body.initData ?? "";

  if (!initData) {
    return NextResponse.json({ ok: false, error: "missing_init_data" }, { status: 400 });
  }

  // Fail closed: without a bot token we cannot verify Telegram identity, so we
  // refuse to mint anything. There is deliberately no unverified fallback.
  if (!BOT_TOKEN) {
    console.error(
      "[questify] telegram-auth: TELEGRAM_BOT_TOKEN is not configured — refusing to issue a session",
    );
    return NextResponse.json({ ok: false, error: "bot_token_not_configured" }, { status: 500 });
  }

  const verified = verifyTelegramInitData(initData, BOT_TOKEN);
  if (!verified) {
    return NextResponse.json({ ok: false, error: "invalid_init_data" }, { status: 401 });
  }

  const user = verified.user;
  const startParamFromInit = verified.startParam;

  // ---- Backend-backed flow ------------------------------------------------
  const admin = getSupabaseAdmin();
  if (isSupabaseConfigured && admin) {
    try {
      const { data: existing } = await admin
        .from("profiles")
        .select("*")
        .eq("telegram_id", user.id)
        .maybeSingle();

      let profile = existing as Profile | null;
      let isNewProfile = false;

      if (!profile) {
        const { data: created, error: createError } = await admin
          .from("profiles")
          .insert({
            telegram_id: user.id,
            username: user.username ?? null,
            first_name: user.first_name ?? null,
            last_name: user.last_name ?? null,
            photo_url: user.photo_url ?? null,
            language_code: user.language_code ?? null,
            is_premium: user.is_premium ?? false,
          })
          .select("*")
          .single();
        if (createError) throw createError;
        profile = created as Profile;
        isNewProfile = true;
      } else {
        await admin
          .from("profiles")
          .update({
            username: user.username ?? profile.username,
            first_name: user.first_name ?? profile.first_name,
            last_name: user.last_name ?? profile.last_name,
            photo_url: user.photo_url ?? profile.photo_url,
          })
          .eq("id", profile.id);
      }

      const { data: wallet } = await admin
        .from("wallets")
        .select("*")
        .eq("user_id", profile.id)
        .maybeSingle();

      // Record the real, DB-backed Telegram link for this account (no mock UI).
      await admin
        .from("connected_accounts")
        .upsert(
          {
            user_id: profile.id,
            provider: "telegram",
            provider_user_id: String(user.id),
            username: user.username ?? null,
          },
          { onConflict: "user_id,provider" },
        );

      // Referral resolution is trust-ordered inside `processReferral`:
      // HMAC-verified initData start_param first, then the client-sent param
      // (tgWebAppStartParam / ?ref=), then an unconsumed pending_referrals row.
      // Eligibility is checked against the account, not "was it just created",
      // so a profile pre-created by any path can still attach a referrer.
      await processReferral(buildReferralRepo(admin), {
        userId: profile.id,
        telegramId: user.id,
        isNewProfile,
        initDataStartParam: startParamFromInit,
        clientParam: body.referralCode ?? null,
      });

      const token = signSession({ sub: profile.id, tg: user.id });
      return NextResponse.json({
        ok: true,
        token,
        profile,
        wallet: (wallet as Wallet) ?? demoWallet(profile.id),
      });
    } catch (err) {
      console.error("[questify] auth db error", err);
      return NextResponse.json({ ok: false, error: "auth_failed" }, { status: 500 });
    }
  }

  // ---- Offline / sandbox flow (opt-in, non-production only) ---------------
  if (!DEMO_MODE) {
    console.error(
      "[questify] telegram-auth: Supabase is not configured and DEMO_MODE is off — refusing to issue a session",
    );
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 500 });
  }

  const profile = demoProfile(user);
  const token = signSession({ sub: profile.id, tg: user.id, demo: true });
  return NextResponse.json({
    ok: true,
    token,
    profile,
    wallet: demoWallet(profile.id),
  });
}

/**
 * Supabase/service-role adapter for the dependency-injected referral engine.
 * The DB enforces the same eligibility rule inside `apply_referral`; the
 * snapshot read here exists so the audit row can carry a precise reason.
 */
function buildReferralRepo(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
): ReferralRepo {
  return {
    async getEligibility(userId) {
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("referred_by, created_at")
        .eq("id", userId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return null;

      const [{ count: completedTasks, error: taskError }, { count: withdrawals, error: withdrawalError }] =
        await Promise.all([
          admin
            .from("user_tasks")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("status", "completed"),
          admin
            .from("withdrawals")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId),
        ]);
      if (taskError) throw taskError;
      if (withdrawalError) throw withdrawalError;

      const { data: consumed, error: consumedError } = await admin
        .from("referrals")
        .select("id")
        .eq("referred_id", userId)
        .limit(1)
        .maybeSingle();
      if (consumedError) throw consumedError;

      return {
        referredBy: (profile.referred_by as string | null) ?? null,
        referralConsumed: Boolean(consumed),
        accountCreatedAt: String(profile.created_at),
        completedTasks: completedTasks ?? 0,
        withdrawals: withdrawals ?? 0,
      };
    },

    async findReferrerIdByCode(code) {
      const { data, error } = await admin
        .from("profiles")
        .select("id")
        .eq("referral_code", code)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data?.id as string | undefined) ?? null;
    },

    async applyReferral(userId, code) {
      const { data, error } = await admin.rpc("apply_referral", {
        p_code: code,
        p_user: userId,
      });
      if (error) throw error;
      return Boolean(data);
    },

    async claimPendingReferral(telegramId) {
      const { data, error } = await admin.rpc("claim_pending_referral", {
        p_telegram_id: telegramId,
      });
      if (error) throw error;
      return typeof data === "string" && data.length > 0 ? data : null;
    },

    async logEvent(event: ReferralEventRecord) {
      const { error } = await admin.from("referral_events").insert({
        telegram_id: event.telegramId,
        source: event.source,
        code_raw: event.codeRaw,
        outcome: event.outcome,
        reason: event.reason,
      });
      if (error) throw error;
    },
  };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "questify-telegram-auth",
    botConfigured: Boolean(BOT_TOKEN),
    demoMode: DEMO_MODE,
    supabaseConfigured: isSupabaseConfigured,
  });
}
