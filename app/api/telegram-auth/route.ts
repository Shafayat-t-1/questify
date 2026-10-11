import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { signSession } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { Profile, Wallet } from "@/lib/types";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_AUTH_AGE_SECONDS = 60 * 60 * 24;

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

interface AuthBody {
  initData?: string;
  referralCode?: string;
}

/** Verify Telegram `initData` signature (HMAC-SHA256, standard WebApp algo). */
function validateInitData(initData: string, botToken: string): boolean {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return false;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseUser(initData: string): TelegramUser | null {
  const raw = new URLSearchParams(initData).get("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TelegramUser;
  } catch {
    return null;
  }
}

function authDateValid(initData: string): boolean {
  const authDate = Number(new URLSearchParams(initData).get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) return false;
  return Date.now() / 1000 - authDate <= MAX_AUTH_AGE_SECONDS;
}

const DEMO_COINS = 3450; // Lv.4 Newbie — matches the premium demo header
const DEMO_USDT = 18.42;

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
    trust_score: 78,
    level: Math.floor(DEMO_COINS / 1000) + 1,
    referral_code: username.slice(0, 6).toUpperCase().padEnd(8, "X"),
    referred_by: null,
    referral_count: 12,
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
  const user = parseUser(initData);

  // Telemetry-free path: with no bot token we accept Telegram-provided identity
  // in development so the Mini App boots without a backend.
  const verified = BOT_TOKEN ? validateInitData(initData, BOT_TOKEN) : false;

  if (BOT_TOKEN && (!verified || !authDateValid(initData))) {
    return NextResponse.json({ ok: false, error: "invalid_init_data" }, { status: 401 });
  }

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
