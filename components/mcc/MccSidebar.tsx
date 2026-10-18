"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, LogOut, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMccIdentity } from "./MccIdentity";
import { NAV_ITEMS, type Tab } from "./nav";

/**
 * Persistent left navigation of the control room (desktop-first).
 *
 * ≥768px: full rail with wordmark, operator identity and labelled nav.
 * <768px: collapses to an icon rail (labels move to `title` tooltips).
 * Sign out is pinned to the bottom of the rail.
 */
export function MccSidebar({
  active,
  onSelect,
  pendingCount,
}: {
  active: Tab;
  onSelect: (tab: Tab) => void;
  pendingCount: number;
}) {
  const router = useRouter();
  const identity = useMccIdentity();
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
    <aside className="mcc-shell flex h-dvh w-16 shrink-0 flex-col border-r border-mcc-line bg-mcc-sidebar md:w-64">
      <div className="flex items-center gap-2.5 border-b border-mcc-line px-3 py-4 md:px-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-mcc-gold/40 bg-mcc-gold/15">
          <ShieldCheck className="h-4.5 w-4.5 text-mcc-gold-bright" />
        </div>
        <div className="hidden min-w-0 md:block">
          <p className="truncate text-[13px] font-bold tracking-tight text-mcc-text">
            Master Control Center
          </p>
          <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-mcc-dim">
            Control room
          </p>
        </div>
      </div>

      <div className="hidden border-b border-mcc-line px-4 py-3 md:block">
        <p className="truncate text-xs font-semibold text-mcc-text">
          {identity.username ?? (identity.telegramId ? `tg ${identity.telegramId}` : "operator")}
        </p>
        {identity.isFounder && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-mcc-gold/40 bg-mcc-gold/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-mcc-gold-bright">
            <Crown className="h-2.5 w-2.5" /> Founder &amp; Supreme Owner
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="Control room sections">
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              title={item.label}
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSelect(item.key)}
              className={cn(
                "group relative flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition md:justify-start",
                isActive
                  ? "bg-mcc-gold/12 text-mcc-gold-bright"
                  : "text-mcc-dim hover:bg-white/[0.05] hover:text-mcc-text",
              )}
            >
              {isActive && (
                <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-mcc-gold" />
              )}
              <item.Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  isActive ? "text-mcc-gold-bright" : "text-mcc-dim group-hover:text-mcc-muted",
                )}
              />
              <span className="hidden md:inline">{item.label}</span>
              {item.key === "payouts" && pendingCount > 0 && (
                <span className="ml-auto hidden rounded-full bg-mcc-gold/20 px-1.5 py-px text-[10px] font-bold tabular-nums text-mcc-gold-bright md:inline">
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-mcc-line p-2">
        <button
          type="button"
          title="Sign out"
          onClick={() => void logout()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-mcc-dim transition hover:bg-white/[0.05] hover:text-mcc-text disabled:opacity-50 md:justify-start"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="hidden md:inline">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
