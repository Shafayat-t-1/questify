import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://questify-nine-tau.vercel.app";
const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || "questify_app_bot";
const MINIAPP_SHORTNAME = process.env.NEXT_PUBLIC_MINIAPP_SHORTNAME || "";

/**
 * Public referral link shared by users. Prefers the Direct-Link form
 * (`t.me/<bot>/<shortname>?startapp=`) because that always delivers the code to
 * the Mini App. Without a shortname it falls back to the bot link
 * (`t.me/<bot>?start=`) which reaches this webhook, where the code is stored as
 * a pending referral — so it never depends on a Main Mini App being configured.
 */
function referralDeepLink(code: string): string {
  if (MINIAPP_SHORTNAME) {
    return `https://t.me/${BOT_USERNAME}/${MINIAPP_SHORTNAME}?startapp=${encodeURIComponent(code)}`;
  }
  return `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(code)}`;
}

interface InlineKeyboardButton {
  text: string;
  url?: string;
  web_app?: { url: string };
}

interface TelegramUpdate {
  message?: {
    chat?: { id?: number | string };
    from?: { id?: number | string };
    text?: string;
  };
}

/**
 * Persist a `/start CODE` payload so telegram-auth can consume it even when the
 * Mini App opens without a `start_param` (inline web_app buttons never carry
 * one). Best-effort: a storage failure must not break the bot reply.
 */
async function storePendingReferral(telegramId: number | string, code: string): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    await admin
      .from("pending_referrals")
      .upsert(
        { telegram_id: telegramId, code, created_at: new Date().toISOString(), consumed_at: null },
        { onConflict: "telegram_id" },
      );
  } catch (err) {
    console.error("[questify] pending referral save failed", err);
  }
}

async function sendMessage(chatId: number | string, text: string, button: InlineKeyboardButton) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [button] },
    }),
  });
}

export async function POST(request: Request) {
  if (!BOT_TOKEN) {
    return NextResponse.json({ ok: false, error: "bot_not_configured" }, { status: 503 });
  }

  // Reject any request that does not carry the secret we registered with
  // Telegram when calling setWebhook. This prevents spoofed webhook traffic.
  if (WEBHOOK_SECRET) {
    const provided = request.headers.get("x-telegram-bot-api-secret-token");
    if (provided !== WEBHOOK_SECRET) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const update = (await request.json().catch(() => ({}))) as TelegramUpdate;
    const chatId = update.message?.chat?.id;
    const text = update.message?.text ?? "";

    if (chatId !== undefined && text.startsWith("/start")) {
      const ref = text.split(/\s+/)[1];
      const fromId = update.message?.from?.id ?? chatId;
      if (ref && ref.length <= 64 && fromId !== undefined) {
        await storePendingReferral(fromId, ref);
      }
      const referralLink = ref ? referralDeepLink(ref) : `https://t.me/${BOT_USERNAME}`;
      const welcome =
        `🎮 <b>Welcome to Questify!</b>\n\n` +
        `Complete tasks, earn coins & USDT, and withdraw real rewards.\n\n` +
        `Your referral link:\n${referralLink}\n\n` +
        `Tap the button below to launch the Mini App.`;

      // `web_app` opens the Mini App as a native Telegram overlay and passes the
      // signed `initData` the backend verifies — never a plain external URL.
      // When the share payload carries a referral code we forward it as `?ref=`
      // so both old (`?start=`) and new (`?startapp=`) links work.
      const launchUrl = ref ? `${APP_URL}?ref=${encodeURIComponent(ref)}` : APP_URL;
      await sendMessage(chatId, welcome, {
        text: "🚀 Open Questify",
        web_app: { url: launchUrl },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[questify] webhook error", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "questify-bot-webhook" });
}
