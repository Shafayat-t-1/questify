import { NextResponse } from "next/server";
import { signSession } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import {
  parseTelegramUser,
  verifyTelegramInitData,
  type TelegramUser,
} from "@/lib/telegram-auth";
import type { Profile, Wallet } from "@/lib/types";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

interface AuthBody {
  initData?: string;
  referralCode?: string;
}

// Sandbox (no-bot-token) profiles start empty — no mock balances, ever.
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

  // When a bot token is configured (production), the HMAC signature and
  // auth_date freshness MUST validate. Without a token (local dev) we fall back
  // to the Telegram-provided identity so the Mini App can boot offline.
  const verified = BOT_TOKEN ? verifyTelegramInitData(initData, BOT_TOKEN) : null;

  if (BOT_TOKEN && !verified) {
    return NextResponse.json({ ok: false, error: "invalid_init_data" }, { status: 401 });
  }

  const startParamFromInit = verified?.startParam ?? null;
  const user: TelegramUser | null = verified?.user ?? parseTelegramUser(initData);

  if (!user || !Number.isFinite(user.id)) {
    return NextResponse.json({ ok: false, error: "missing_user" }, { status: 400 });
  }

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

      // Link referral if provided via start param or referralCode
      const referralCode = body.referralCode ?? startParamFromInit ?? undefined;
      if (referralCode) {
        try {
          await admin.rpc("apply_referral", {
            p_code: referralCode,
            p_user: profile.id,
          });
        } catch (e) {
          console.warn("[questify] referral link failed", e);
        }
      }

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

  // ---- Offline / sandbox flow --------------------------------------------
  const profile = demoProfile(user);
  const token = signSession({ sub: profile.id, tg: user.id, demo: true });
  return NextResponse.json({
    ok: true,
    token,
    profile,
    wallet: demoWallet(profile.id),
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "questify-telegram-auth",
    botConfigured: Boolean(BOT_TOKEN),
    supabaseConfigured: isSupabaseConfigured,
  });
}
