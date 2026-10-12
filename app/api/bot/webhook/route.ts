import { NextResponse } from "next/server";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function POST(request: Request) {
  if (!BOT_TOKEN) {
    return NextResponse.json({ ok: false, error: "bot_not_configured" }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const update = body as Record<string, unknown>;

    if (update && typeof update === "object" && "message" in update) {
      const msg = (update as Record<string, unknown>).message as Record<string, unknown>;
      const chat = (msg as Record<string, unknown>).chat as Record<string, unknown> | undefined;
      const chatId = chat?.id as string | number | undefined;
      const text = (msg.text as string) || "";

      if (text.startsWith("/start")) {
        const parts = text.split(/\s+/);
        const ref = parts[1];
        const referralLink = ref
          ? `https://t.me/questify_bot?start=${ref}`
          : "https://t.me/questify_bot?start";
        const welcome = `🎮 Welcome to Questify!\n\nComplete tasks, earn coins & USDT, and withdraw rewards.\n\nYour referral link: ${referralLink}\n\nUse the Mini App to get started.`;
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: welcome,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "🚀 Open Questify", url: process.env.NEXT_PUBLIC_APP_URL || "https://t.me/questify_bot/app" },
                ],
              ],
            },
          }),
        });
        return NextResponse.json({ ok: true });
      }
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
