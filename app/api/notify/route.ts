import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function POST(request: Request) {
  if (!BOT_TOKEN) {
    return NextResponse.json({ ok: false, error: "bot_not_configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { userId, type, message } = body as {
      userId?: string;
      type?: string;
      message?: string;
    };

    if (!userId) {
      return NextResponse.json({ ok: false, error: "missing_user" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    let telegramId: string | null = null;

    if (admin) {
      const { data } = await admin.from("profiles").select("telegram_id").eq("id", userId).maybeSingle();
      telegramId = data?.telegram_id?.toString() || null;
    } else {
      telegramId = userId.replace(/^demo-/, "");
    }

    if (!telegramId) {
      return NextResponse.json({ ok: false, error: "no_telegram_id" }, { status: 400 });
    }

    const text = message || (type === "withdrawal" ? "✅ Withdrawal processed!" : "🎉 Task completed successfully!");
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, text }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[questify] notify error", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
