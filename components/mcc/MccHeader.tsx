"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, ShieldCheck, Crown } from "lucide-react";

interface MccHeaderProps {
  username: string | null;
  telegramId: number | null;
  isFounder: boolean;
}

/** MCC top bar: identity, founder label (cosmetic) and cookie logout. */
export function MccHeader({ username, telegramId, isFounder }: MccHeaderProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await fetch("/api/mcc-auth", { method: "DELETE", credentials: "same-origin" });
    } finally {
      router.replace("/mcc/login");
      router.refresh();
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0E14]/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-neon-orange/30 to-neon-cyan/15">
            <ShieldCheck className="h-4 w-4 text-neon-orange" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-white">
              Master Control Center
            </p>
            <p className="flex items-center gap-1.5 truncate text-[11px] text-white/45">
              {username ?? (telegramId ? `tg ${telegramId}` : "operator")}
              {isFounder && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-amber-200">
                  <Crown className="h-2.5 w-2.5" /> Founder &amp; Supreme Owner
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => void logout()}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white/60 transition hover:text-white active:scale-95 disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </header>
  );
}
