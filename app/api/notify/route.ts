import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { boundedString, isUuid } from "@/lib/validation";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const NOTIFY_SECRET = process.env.NOTIFY_SECRET ?? process.env.TELEGRAM_WEBHOOK_SECRET;

const ALLOWED_TYPES = ["withdrawal", "task", "system"] as const;

/**
 * Server-to-server push endpoint. Previously an unauthenticated open relay that
 * let anyone send Telegram DMs through the bot — now it fails closed unless a
 * shared secret is configured AND supplied in the `x-notify-secret` header.
 */
export async function POST(request: Request) {
  if (!BOT_TOKEN) {
    return NextResponse.json({ ok: false, error: "bot_not_configured" }, { status: 503 });
  }
  if (!NOTIFY_SECRET) {
    return NextResponse.json({ ok: false, error: "notify_disabled" }, { status: 503 });
  }

  const provided = request.headers.get("x-notify-secret");
  if (provided !== NOTIFY_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { userId?: unknown; type?: unknown; message?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const userId = body.userId;
  if (typeof userId !== "string") {
    return NextResponse.json({ ok: false, error: "missing_user" }, { status: 400 });
  }

  const type =
    typeof body.type === "string" && (ALLOWED_TYPES as readonly string[]).includes(body.type)
      ? body.type
      : "system";
  const message = boundedString(body.message, 4096);

  const admin = getSupabaseAdmin();
  let telegramId: string | null = null;

  if (admin && isUuid(userId)) {
    const { data } = await admin
      .from("profiles")
      .select("telegram_id")
      .eq("id", userId)
      .maybeSingle();
    telegramId =
      data?.telegram_id === undefined || data?.telegram_id === null
        ? null
        : String(data.telegram_id);
  } else if (!admin) {
    telegramId = /^demo-\d+$/.test(userId) ? userId.replace(/^demo-/, "") : null;
  }

  if (!telegramId) {
    return NextResponse.json({ ok: false, error: "no_telegram_id" }, { status: 404 });
  }

  const text =
    message ||
    (type === "withdrawal"
      ? "✅ Withdrawal processed!"
      : type === "task"
        ? "🎉 Task completed successfully!"
        : "Questify update");

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: telegramId, text }),
  });

  return NextResponse.json({ ok: true });
}
