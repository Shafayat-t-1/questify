"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

interface LoginWidgetProps {
  botUsername: string;
  brandName: string;
}

/**
 * Embeds the official Telegram Login Widget (legacy `data-onauth` callback).
 * The raw object Telegram hands to the callback is POSTed untouched to
 * `/api/mcc-auth`, which verifies the widget HMAC server-side, checks
 * `profiles.is_admin` and only then sets the httpOnly session cookie. No
 * identity decision is ever made on this side.
 */
export function LoginWidget({ botUsername, brandName }: LoginWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleAuth = async (user: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/mcc-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          redirectTo?: string;
          error?: string;
        };
        if (!res.ok || !json.ok) {
          const mapped =
            json.error === "forbidden" || json.error === "unknown_user"
              ? "This Telegram account has no admin access."
              : json.error === "invalid_login_signature"
                ? "Telegram login could not be verified. Try again."
                : json.error === "rate_limited"
                  ? "Too many attempts. Wait a minute and retry."
                  : json.error ?? "Login failed.";
          setError(mapped);
          setBusy(false);
          return;
        }
        window.location.assign(json.redirectTo ?? "/mcc");
      } catch {
        setError("Network error — check your connection and retry.");
        setBusy(false);
      }
    };

    (window as unknown as { onMccTelegramAuth?: (u: Record<string, unknown>) => void }).onMccTelegramAuth =
      handleAuth;

    const el = containerRef.current;
    if (el) {
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://telegram.org/js/telegram-widget.js?22";
      script.setAttribute("data-telegram-login", botUsername);
      script.setAttribute("data-size", "large");
      script.setAttribute("data-userpic", "false");
      script.setAttribute("data-onauth", "onMccTelegramAuth(user)");
      el.appendChild(script);
    }

    return () => {
      delete (window as unknown as { onMccTelegramAuth?: unknown }).onMccTelegramAuth;
    };
  }, [botUsername]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center backdrop-blur-xl">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-neon-orange/25 to-neon-cyan/15">
          <ShieldCheck className="h-6 w-6 text-neon-orange" />
        </div>
        <h1 className="mt-4 text-lg font-bold tracking-tight text-white">
          {brandName} · Master Control Center
        </h1>
        <p className="mt-1.5 text-xs text-white/45">
          Operator access only. Sign in with the Telegram account that owns this bot —
          the domain must be linked via <span className="font-mono text-white/60">/setdomain</span> in @BotFather.
        </p>

        <div className="mt-5 flex min-h-48 items-center justify-center">
          {busy ? (
            <Loader2 className="h-6 w-6 animate-spin text-neon-orange" />
          ) : (
            <div ref={containerRef} className="[&_iframe]:mx-auto" />
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-left text-xs text-red-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="mt-5 text-[10px] leading-relaxed text-white/35">
          Sessions are issued only to profiles with admin rights. The widget proves the
          account is who it claims to be; the server decides whether it may enter.
        </p>
      </div>
    </div>
  );
}
