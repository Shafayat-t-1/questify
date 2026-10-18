"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, XCircle, AlertTriangle, ArrowLeft } from "lucide-react";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  discord: "Discord",
};

const REASON_TEXT: Record<string, string> = {
  ok: "",
  state: "This sign-in link expired or was already used. Please start again from your profile.",
  denied: "You cancelled the sign-in on the provider's page.",
  code: "The provider did not send a sign-in code. Please try again.",
  identity_taken: "That account is already linked to a different Questify account.",
  not_configured: "OAuth isn't configured for this provider yet.",
  exchange_failed: "Could not complete the sign-in with the provider. Please try again.",
  lookup_failed: "Something went wrong. Please try again.",
  link_failed: "Could not save the linked account. Please try again.",
};

function ResultBody() {
  const params = useSearchParams();
  const provider = params.get("provider") ?? "";
  const status = params.get("status") ?? "error";
  const reason = params.get("reason") ?? "";
  const providerLabel = PROVIDER_LABELS[provider] ?? provider;

  const isLinked = status === "linked";
  const isRejected = status === "rejected";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <span
        className={
          isLinked
            ? "grid h-16 w-16 place-items-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
            : isRejected
              ? "grid h-16 w-16 place-items-center rounded-2xl border border-amber-400/30 bg-amber-400/10 text-amber-300"
              : "grid h-16 w-16 place-items-center rounded-2xl border border-red-400/30 bg-red-400/10 text-red-300"
        }
      >
        {isLinked ? (
          <CheckCircle2 className="h-8 w-8" />
        ) : isRejected ? (
          <XCircle className="h-8 w-8" />
        ) : (
          <AlertTriangle className="h-8 w-8" />
        )}
      </span>

      <h1 className="mt-5 text-lg font-semibold text-white">
        {isLinked
          ? `${providerLabel} linked`
          : isRejected
            ? "Sign-in not completed"
            : "Sign-in failed"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-white/50">
        {isLinked
          ? `Your ${providerLabel} account is now connected and verified.`
          : REASON_TEXT[reason] || "Something went wrong. Please try again."}
      </p>

      <Link
        href="/"
        className="mt-7 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-neon-orange to-amber-500 px-6 py-3 text-sm font-bold text-black transition active:scale-[0.98]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Questify
      </Link>
      <p className="mt-3 text-[11px] text-white/35">
        {isLinked ? "Return to your profile to see it connected." : ""}
      </p>
    </main>
  );
}

export default function OAuthResultPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-dvh w-full max-w-md items-center justify-center text-white/50">
          Loading…
        </main>
      }
    >
      <ResultBody />
    </Suspense>
  );
}
