"use client";

import { useEffect, useState } from "react";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || "questify_app_bot";
const BOT_URL = `https://t.me/${BOT_USERNAME}`;

type GateState = "checking" | "inside" | "outside";

/**
 * Client-side anti-bypass gate. Questify is a Telegram Mini App and every API
 * route requires a signature-verified Telegram session, so rendering the real
 * app outside Telegram would only ever show broken/empty states. Instead we
 * hold the app until `window.Telegram.WebApp.initData` is present and, when it
 * is not, render a clean landing that funnels the visitor into Telegram.
 */
export function TelegramGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("checking");

  useEffect(() => {
    let attempts = 0;
    let timer: number | undefined;

    const evaluate = () => {
      const tg = window.Telegram?.WebApp;
      const hasInitData = Boolean(tg?.initData && tg.initData.length > 0);
      if (hasInitData) {
        setState("inside");
        return;
      }
      // The SDK is loaded `beforeInteractive`, but allow a few ticks in case the
      // script is still initialising on slow connections.
      attempts += 1;
      if (attempts < 10) {
        timer = window.setTimeout(evaluate, 100);
        return;
      }
      setState("outside");
    };

    evaluate();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  if (state === "checking") {
    return <div className="min-h-dvh bg-[#0B0E14]" aria-busy="true" />;
  }

  if (state === "outside") {
    return <OutsideTelegram />;
  }

  return <>{children}</>;
}

function OutsideTelegram() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#0B0E14] px-6 text-center text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 h-72 w-72 rounded-full bg-neon-orange/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl"
      />

      <div className="relative z-10 flex max-w-sm flex-col items-center gap-5">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-neon-orange to-orange-600 text-4xl shadow-lg shadow-orange-900/40">
          🎮
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Questify</h1>
          <p className="text-sm leading-relaxed text-white/70">
            Questify is a Telegram Mini App. Complete tasks, earn coins &amp; USDT,
            and withdraw rewards — all inside Telegram.
          </p>
        </div>

        <div className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
          Please open <span className="font-semibold text-white">Questify</span>{" "}
          inside Telegram to play.
        </div>

        <a
          href={BOT_URL}
          className="w-full rounded-xl bg-neon-orange px-5 py-3 text-sm font-semibold text-black transition active:scale-[0.98]"
        >
          Open in Telegram
        </a>

        <p className="text-xs text-white/40">
          Tip: launch it from the <span className="text-white/60">@{BOT_USERNAME}</span> bot menu.
        </p>
      </div>
    </div>
  );
}
