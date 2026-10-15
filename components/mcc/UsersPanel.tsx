"use client";

import { useState } from "react";
import { Ban, Crown, Search, ShieldCheck, UserCheck } from "lucide-react";
import { adminFetch } from "@/lib/admin-client";
import { cn, formatCoins, formatUsdt } from "@/lib/utils";
import type { MccUser } from "./types";

export function UsersPanel({
  users,
  onReload,
  notify,
}: {
  users: MccUser[];
  onReload: () => void;
  notify: (kind: "success" | "error", title: string, message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MccUser[] | null>(null);
  const [selected, setSelected] = useState<MccUser | null>(null);
  const [coins, setCoins] = useState("");
  const [usdt, setUsdt] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const list = results ?? users;

  const search = async () => {
    setBusy(true);
    const res = await adminFetch<MccUser[]>("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "lookup_user", query: query.trim() || null, limit: 25, offset: 0 }),
    });
    setBusy(false);
    if (!res.ok) return notify("error", "Lookup failed", res.error ?? "failed");
    setResults(Array.isArray(res.data) ? res.data : []);
  };

  const toggleBan = async (user: MccUser) => {
    setBusy(true);
    const res = await adminFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "update_user", userId: user.id, is_banned: !user.is_banned }),
    });
    setBusy(false);
    if (!res.ok) return notify("error", "Update failed", res.error ?? "failed");
    notify("success", user.is_banned ? "User unbanned" : "User banned", user.username ?? "user");
    const next = { ...user, is_banned: !user.is_banned };
    setSelected((prev) => (prev?.id === user.id ? next : prev));
    setResults((prev) => (prev ? prev.map((u) => (u.id === user.id ? next : u)) : prev));
    onReload();
  };

  const adjust = async () => {
    if (!selected) return;
    const deltaCoins = Number.parseInt(coins || "0", 10);
    const deltaUsdt = Number.parseFloat(usdt || "0");
    if (!Number.isFinite(deltaCoins) || !Number.isFinite(deltaUsdt)) {
      return notify("error", "Invalid amount", "Enter numeric deltas.");
    }
    if (deltaCoins === 0 && deltaUsdt === 0) {
      return notify("error", "Empty adjustment", "Enter a coin and/or USDT delta.");
    }
    if (!reason.trim()) {
      return notify("error", "Reason required", "Every balance change needs an audit reason.");
    }
    setBusy(true);
    const res = await adminFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({
        action: "adjust_balance",
        userId: selected.id,
        delta_coins: deltaCoins,
        delta_usdt: deltaUsdt,
        reason: reason.trim(),
      }),
    });
    setBusy(false);
    if (!res.ok) return notify("error", "Adjustment failed", res.error ?? "failed");
    notify("success", "Balance adjusted", `${deltaCoins >= 0 ? "+" : ""}${deltaCoins} coins, ${deltaUsdt >= 0 ? "+" : ""}${deltaUsdt} USDT`);
    setCoins("");
    setUsdt("");
    setReason("");
    onReload();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
          placeholder="Search username, telegram id or referral code"
          className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-neon-orange/40 focus:outline-none"
        />
        <button
          onClick={() => void search()}
          disabled={busy}
          className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-gradient-to-br from-neon-orange to-amber-500 text-black transition active:scale-95 disabled:opacity-50"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>
        {results && (
          <button
            onClick={() => {
              setResults(null);
              setQuery("");
            }}
            className="rounded-xl border border-white/10 px-3 text-xs text-white/60"
          >
            Reset
          </button>
        )}
      </div>

      {selected && (
        <div className="rounded-2xl border border-neon-orange/30 bg-neon-orange/[0.06] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-sm font-semibold text-white">
                {selected.username ?? selected.first_name ?? "user"}
                {selected.is_founder && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-amber-200">
                    <Crown className="h-2.5 w-2.5" /> Founder
                  </span>
                )}
                {selected.is_admin && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-neon-cyan/40 bg-neon-cyan/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-neon-cyan">
                    <ShieldCheck className="h-2.5 w-2.5" /> Admin
                  </span>
                )}
                {selected.is_banned && (
                  <span className="rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-red-300">
                    Banned
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-[11px] text-white/50">
                {formatCoins(selected.coins)} coins · {formatUsdt(selected.usdt_balance)} USDT · trust{" "}
                {selected.trust_score} · Lv.{selected.level}
              </p>
              <p className="mt-0.5 text-[10px] text-white/35">
                tg {selected.telegram_id ?? "—"} · code {selected.referral_code ?? "—"} · referred by{" "}
                {selected.referred_by ?? "—"} (tier-2 {selected.referred_by_tier2 ?? "—"})
              </p>
            </div>
            <button
              onClick={() => void toggleBan(selected)}
              disabled={busy}
              className={cn(
                "flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition active:scale-95 disabled:opacity-50",
                selected.is_banned
                  ? "border-emerald-400/40 text-emerald-300"
                  : "border-red-500/40 text-red-300",
              )}
            >
              {selected.is_banned ? <UserCheck className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
              {selected.is_banned ? "Unban user" : "Ban user"}
            </button>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[8rem_8rem_1fr_auto]">
            <input
              value={coins}
              onChange={(e) => setCoins(e.target.value)}
              inputMode="numeric"
              placeholder="± coins"
              className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
            />
            <input
              value={usdt}
              onChange={(e) => setUsdt(e.target.value)}
              inputMode="decimal"
              placeholder="± USDT"
              className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required — written to the audit log)"
              className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
            />
            <button
              onClick={() => void adjust()}
              disabled={busy}
              className="rounded-xl bg-neon-orange px-4 py-2 text-xs font-bold text-black transition active:scale-95 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
          <p className="mt-2 text-[10px] text-white/35">
            Balances move only through the audited admin RPC (ledger entry + admin_actions row, same
            transaction). The reason is validated server-side; a blank reason is rejected.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {list.map((u) => (
          <button
            key={u.id}
            onClick={() => setSelected(u)}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99]",
              selected?.id === u.id
                ? "border-neon-orange/40 bg-neon-orange/[0.06]"
                : "border-white/10 bg-white/[0.03]",
            )}
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-medium text-white">
                {u.username ?? u.first_name ?? "anon"}
                {u.is_founder && <Crown className="h-3 w-3 text-amber-300" />}
                {u.is_banned && <span className="text-[10px] font-bold text-red-400">BANNED</span>}
              </p>
              <p className="text-[11px] text-white/45">
                {formatCoins(u.coins)} coins · {formatUsdt(u.usdt_balance)} USDT · trust {u.trust_score}
              </p>
            </div>
            <span className="shrink-0 text-[10px] text-white/30">{u.telegram_id ?? "—"}</span>
          </button>
        ))}
        {list.length === 0 && (
          <p className="py-8 text-center text-xs text-white/40">No users found.</p>
        )}
      </div>
    </div>
  );
}
