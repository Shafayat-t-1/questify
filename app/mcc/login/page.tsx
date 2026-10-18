import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { envConfig } from "@/lib/config";
import { loadMccAdminProfile, verifyMccToken } from "@/lib/mcc-auth";
import { MCC_SESSION_COOKIE } from "@/lib/session";
import { LoginWidget } from "@/components/mcc/LoginWidget";

export const instant = false;

/** Human-readable outcomes of a magic-link redemption (/api/mcc-magic). */
const MAGIC_ERRORS: Record<string, string> = {
  missing: "This login link is incomplete. Send /login to the bot for a fresh one.",
  not_found: "Login link not recognised. Send /login to the bot for a fresh one.",
  used: "That login link was already used. Send /login to the bot for a new one.",
  expired: "That login link expired after 5 minutes. Send /login to the bot for a fresh one.",
  invalid: "That login link is not valid. Send /login to the bot for a fresh one.",
  forbidden: "This Telegram account no longer has admin access to the control center.",
  unavailable: "Login is temporarily unavailable. Wait a moment and send /login again.",
};

/**
 * Public entry point of the control center. Already-authenticated admins are
 * bounced straight to /mcc. Everyone else gets the bot-issued magic link as
 * the PRIMARY sign-in path (message @bot /login), with the official Telegram
 * Login Widget kept as a secondary option — its server-side confirmation flow
 * (oauth.telegram.org) has been unreliable, while the bot webhook path is
 * fully under our control. Verification always happens server-side; this page
 * never decides identity.
 */
export default async function MccLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const store = await cookies();
  const payload = verifyMccToken(store.get(MCC_SESSION_COOKIE)?.value ?? null);
  if (payload) {
    const context = await loadMccAdminProfile(payload.sub);
    if (context) redirect("/mcc");
  }

  const config = envConfig();
  const { error } = await searchParams;
  const magicError = error ? (MAGIC_ERRORS[error] ?? MAGIC_ERRORS.invalid) : null;
  const botDeepLink = `https://t.me/${config.botUsername}`;

  return (
    <div className="mcc-shell flex min-h-dvh flex-col items-center justify-center gap-8 bg-mcc-bg px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-mcc-line bg-mcc-surface p-6">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-mcc-gold/40 bg-mcc-gold/15 text-xl">
          🎮
        </div>
        <h1 className="mt-4 text-center text-lg font-bold tracking-tight text-mcc-text">
          {config.brandName} · Master Control Center
        </h1>
        <p className="mt-1.5 text-center text-xs text-mcc-muted">
          Operator access only. Sign-in is bot-issued — a link is only ever sent to a
          Telegram account with admin rights.
        </p>

        {magicError && (
          <div
            role="alert"
            className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200"
          >
            {magicError}
          </div>
        )}

        <ol className="mt-5 space-y-3 text-left text-xs leading-relaxed text-mcc-muted">
          <li className="flex gap-2.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-mcc-gold/15 font-mono text-[10px] font-bold text-mcc-gold-bright">
              1
            </span>
            <span>
              Open{" "}
              <a
                href={botDeepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-mcc-teal underline underline-offset-2"
              >
                @{config.botUsername}
              </a>{" "}
              and send <span className="font-mono text-mcc-text">/login</span>.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-mcc-gold/15 font-mono text-[10px] font-bold text-mcc-gold-bright">
              2
            </span>
            <span>
              The bot replies with a private link, valid for <b>5 minutes</b> and{" "}
              <b>usable once</b>.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-mcc-gold/15 font-mono text-[10px] font-bold text-mcc-gold-bright">
              3
            </span>
            <span>Tap the link — the dashboard opens already signed in.</span>
          </li>
        </ol>

        <p className="mt-5 text-center text-[10px] leading-relaxed text-mcc-dim">
          No link arrives? That account has no admin rights — the bot replies to everyone
          else with nothing.
        </p>
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-3 flex items-center gap-3">
          <span className="h-px flex-1 bg-mcc-line" />
          <span className="text-[10px] uppercase tracking-wider text-mcc-dim">
            secondary option
          </span>
          <span className="h-px flex-1 bg-mcc-line" />
        </div>
        <LoginWidget botUsername={config.botUsername} brandName={config.brandName} />
      </div>
    </div>
  );
}
