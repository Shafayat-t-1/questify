import { NextResponse } from "next/server";
import { signSession } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { verifyTelegramInitData, type TelegramUser } from "@/lib/telegram-auth";
import { isValidReferralCode } from "@/lib/validation";
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

      // Referrals are applied ONLY when this request created the profile.
      await applyReferralIfNew(admin, profile, isNewProfile, body.referralCode ?? startParamFromInit);

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
 * Apply a referral code, logging a single non-personal outcome. Skips when the
 * profile is not new, the code is malformed, or it is the user's own code.
 */
async function applyReferralIfNew(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  profile: Profile,
  isNewProfile: boolean,
  rawCode: string | null | undefined,
): Promise<void> {
  if (!rawCode) return;

  if (!isNewProfile) {
    console.info("[questify] referral_skipped", { reason: "not_new_profile" });
    return;
  }
  if (!isValidReferralCode(rawCode)) {
    console.info("[questify] referral_skipped", { reason: "invalid_code" });
    return;
  }
  if (profile.referral_code && rawCode.trim().toUpperCase() === profile.referral_code.toUpperCase()) {
    console.info("[questify] referral_skipped", { reason: "self_referral" });
    return;
  }

  try {
    const { data, error } = await admin.rpc("apply_referral", {
      p_code: rawCode,
      p_user: profile.id,
    });
    if (error) throw error;
    if (data) {
      console.info("[questify] referral_applied");
    } else {
      console.info("[questify] referral_skipped", { reason: "unknown_or_already_referred" });
    }
  } catch (e) {
    console.warn("[questify] referral link failed", e instanceof Error ? e.message : "unknown");
  }
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
