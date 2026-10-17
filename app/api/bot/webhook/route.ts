import { NextResponse } from "next/server";
import {
  hashMccMagicToken,
  signMccMagicToken,
  MCC_MAGIC_TTL_SECONDS,
} from "@/lib/mcc-magic";
import { getSupabaseAdmin } from "@/lib/supabase";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://questify-nine-tau.vercel.app";
const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || "questify_app_bot";
const MINIAPP_SHORTNAME = process.env.NEXT_PUBLIC_MINIAPP_SHORTNAME || "";

/** Magic-link requests allowed per telegram id per hour (`/login` command). */
const LOGIN_RATE_MAX = 5;
const LOGIN_RATE_WINDOW_SECONDS = 60 * 60;

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
    chat?: { id?: number | string; type?: string };
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

/**
 * Strip credential-bearing query values (e.g. the single-use magic-link
 * `token=...`) from anything we are about to log. Response bodies echo the sent
 * text, which for `/login` contains the raw magic token — that must never reach
 * the logs.
 */
function redactSecrets(value: string): string {
  return value.replace(/([?&]token=)[^&\s"\\]+/gi, "$1<redacted>");
}

function urlOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return "<invalid-url>";
  }
}

/**
 * Send one message via the Telegram Bot API.
 *
 * Diagnostic rules (Phase DEBUG): every request and every Telegram response is
 * logged with console.log/console.error so a silent sendMessage rejection is
 * impossible to miss in plain Vercel function logs — no paid Observability
 * needed. The bot token is NEVER logged, only its presence/length/format. The
 * signed magic-link URL is never logged either (redacted).
 *
 * parse_mode is OFF by default: plain text needs no escaping and Telegram
 * auto-links a bare URL on its own line. Callers that genuinely use markup must
 * opt in via `options.parseMode` and escape dynamic content.
 */
async function sendMessage(
  chatId: number | string,
  text: string,
  button: InlineKeyboardButton,
  options?: { parseMode?: "HTML" },
): Promise<Response | null> {
  const parseMode = options?.parseMode;
  const payload: {
    chat_id: number | string;
    text: string;
    disable_web_page_preview: boolean;
    reply_markup: { inline_keyboard: InlineKeyboardButton[][] };
    parse_mode?: "HTML";
  } = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    // Telegram requires `inline_keyboard` to be an Array of Arrays — one inner
    // array per button row ("Bad Request: expected an Array of InlineKeyboardButton"
    // otherwise). See https://core.telegram.org/bots/api#inlinekeyboardmarkup
    reply_markup: { inline_keyboard: [[button]] },
  };
  if (parseMode) payload.parse_mode = parseMode;

  console.log("[questify] sendMessage request", {
    chat_id: chatId,
    chat_id_type: typeof chatId,
    text_length: text.length,
    parse_mode: parseMode ?? null,
    button_kind: button.web_app ? "web_app" : "url",
    button_url_origin: urlOrigin(button.url),
    button_web_app_origin: urlOrigin(button.web_app?.url),
    bot_token_present: Boolean(BOT_TOKEN),
    bot_token_length: BOT_TOKEN?.length ?? 0,
    bot_token_has_surrounding_whitespace: BOT_TOKEN !== BOT_TOKEN?.trim(),
    bot_token_format_ok: /^\d+:[A-Za-z0-9_-]+$/.test(BOT_TOKEN ?? ""),
  });

  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[questify] sendMessage network error", err);
    return null;
  }

  let body = "";
  try {
    body = await res.text();
  } catch (err) {
    body = `<response body unreadable: ${String(err)}>`;
  }

  const redacted = redactSecrets(body);
  console.log("[questify] sendMessage response", { status: res.status, ok: res.ok, body: redacted });
  if (!res.ok) {
    console.error("[questify] sendMessage FAILED", { status: res.status, body: redacted });
  }
  return res;
}

/** `/login` spam guard: 5 magic-link requests per telegram id per hour. */
async function loginRateLimited(telegramId: number): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  try {
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: `rl:mcc_login_cmd:${telegramId}`,
      p_max: LOGIN_RATE_MAX,
      p_window_seconds: LOGIN_RATE_WINDOW_SECONDS,
    });
    if (error) {
      // Same fail-open posture as /api/mcc-auth: the limiter must never lock
      // the operator out on a storage blip. Admin gating still applies below.
      console.error("[questify] login rate limit check failed", error);
      return false;
    }
    return data === false;
  } catch (err) {
    console.error("[questify] login rate limit check failed", err);
    return false;
  }
}

/**
 * `/login` — primary MCC auth path (Phase 3A-FIX). Replies with a single-use,
 * 5-minute magic link, but ONLY to a telegram id whose profile has
 * is_admin = true. Everyone else is ignored silently: the bot must never
 * reveal whether an account has admin rights. The raw token exists only in
 * the link; the DB row stores its SHA-256 hash.
 */
async function handleLoginCommand(chatId: number | string, fromId: number): Promise<NextResponse> {
  if (await loginRateLimited(fromId)) {
    await sendMessage(
      chatId,
      "Too many login-link requests. Wait a while and send /login again.",
      { text: "Questify", url: `https://t.me/${BOT_USERNAME}` },
    );
    return NextResponse.json({ ok: true });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: true });

  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, is_admin")
    .eq("telegram_id", fromId)
    .maybeSingle();
  if (error) {
    console.error("[questify] login admin lookup failed", error);
    return NextResponse.json({ ok: true });
  }
  // Unknown or non-admin: answer with an empty 200 and no message.
  if (!profile || !profile.is_admin) return NextResponse.json({ ok: true });

  const raw = signMccMagicToken(profile.id as string);
  const { error: insertError } = await admin.from("mcc_magic_tokens").insert({
    token_hash: hashMccMagicToken(raw),
    user_id: profile.id,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + MCC_MAGIC_TTL_SECONDS * 1000).toISOString(),
    used_at: null,
  });
  if (insertError) {
    console.error("[questify] magic token save failed", insertError);
    await sendMessage(chatId, "Could not create a login link right now. Try again in a minute.", {
      text: "Questify",
      url: `https://t.me/${BOT_USERNAME}`,
    });
    return NextResponse.json({ ok: true });
  }

  const link = `${APP_URL}/mcc/magic?token=${encodeURIComponent(raw)}`;
  // Plain text (no parse_mode): the signed URL is a JWT with `.`, `-`, `_` and
  // `%` escapes that are hazardous under MarkdownV2 and unnecessary under HTML.
  // Without parse_mode Telegram auto-links the bare URL on its own line.
  await sendMessage(
    chatId,
    `🔐 MCC login link\n\n` +
      `Single use · valid for 5 minutes · bound to your admin account.\n\n` +
      `${link}`,
    { text: "🔓 Open control center", url: link },
  );
  return NextResponse.json({ ok: true });
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

    console.log("[questify] webhook update", {
      chat_id: chatId,
      chat_id_type: typeof chatId,
      chat_type: update.message?.chat?.type ?? null,
      from_id: update.message?.from?.id ?? null,
      text: text.slice(0, 64),
    });

    if (chatId !== undefined && text.startsWith("/start")) {
      const ref = text.split(/\s+/)[1];
      const fromId = update.message?.from?.id ?? chatId;
      if (ref && ref.length <= 64 && fromId !== undefined) {
        await storePendingReferral(fromId, ref);
      }
      const referralLink = ref ? referralDeepLink(ref) : `https://t.me/${BOT_USERNAME}`;
      const welcome =
        `🎮 <b>Welcome to Questify!</b>\n\n` +
        `Complete tasks, earn coins &amp; USDT, and withdraw real rewards.\n\n` +
        `Your referral link:\n${referralLink}\n\n` +
        `Tap the button below to launch the Mini App.`;

      // `web_app` opens the Mini App as a native Telegram overlay and passes the
      // signed `initData` the backend verifies — never a plain external URL.
      // When the share payload carries a referral code we forward it as `?ref=`
      // so both old (`?start=`) and new (`?startapp=`) links work.
      const launchUrl = ref ? `${APP_URL}?ref=${encodeURIComponent(ref)}` : APP_URL;
      await sendMessage(
        chatId,
        welcome,
        {
          text: "🚀 Open Questify",
          web_app: { url: launchUrl },
        },
        { parseMode: "HTML" },
      );
      return NextResponse.json({ ok: true });
    }

    // `/login` (and the `/login@botname` group form) — MCC magic link.
    const command = (text.split(/\s+/)[0] ?? "").split("@")[0].toLowerCase();
    if (command === "/login") {
      const fromId = update.message?.from?.id;
      if (fromId === undefined || chatId === undefined) {
        return NextResponse.json({ ok: true });
      }
      return handleLoginCommand(chatId, Number(fromId));
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
