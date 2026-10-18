"use client";

import { useState } from "react";
import { Ban, ChevronRight, Crown, Search, ShieldCheck, UserCheck } from "lucide-react";
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
          className="min-w-0 flex-1 rounded-lg border border-mcc-line bg-mcc-inset px-3.5 py-2.5 text-sm text-mcc-text placeholder:text-mcc-dim focus:border-mcc-gold/50 focus:outline-none"
        />
        <button
          onClick={() => void search()}
          disabled={busy}
          className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-lg bg-mcc-gold text-mcc-bg transition hover:bg-mcc-gold-bright active:scale-95 disabled:opacity-50"
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
            className="rounded-lg border border-mcc-line px-3 text-xs text-mcc-muted transition hover:border-mcc-line-strong hover:text-mcc-text"
          >
            Reset
          </button>
        )}
      </div>

      {selected && (
        <div className="rounded-xl border border-mcc-gold/35 bg-mcc-gold/[0.06] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-mcc-text">
                {selected.username ?? selected.first_name ?? "user"}
                {selected.is_founder && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-mcc-gold/40 bg-mcc-gold/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-mcc-gold-bright">
                    <Crown className="h-2.5 w-2.5" /> Founder
                  </span>
                )}
                {selected.is_admin && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-mcc-teal/40 bg-mcc-teal/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-mcc-teal">
                    <ShieldCheck className="h-2.5 w-2.5" /> Admin
                  </span>
                )}
                {selected.is_banned && (
                  <span className="rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-red-300">
                    Banned
                  </span>
                )}
              </p>
              <p className="mt-1 text-[11px] tabular-nums text-mcc-muted">
                {formatCoins(selected.coins)} coins · {formatUsdt(selected.usdt_balance)} USDT · trust{" "}
                {selected.trust_score} · Lv.{selected.level}
              </p>
              <p className="mt-0.5 text-[10px] tabular-nums text-mcc-dim">
                tg {selected.telegram_id ?? "—"} · code {selected.referral_code ?? "—"} · referred by{" "}
                {selected.referred_by ?? "—"} (tier-2 {selected.referred_by_tier2 ?? "—"})
              </p>
            </div>
            <button
              onClick={() => void toggleBan(selected)}
              disabled={busy}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition active:scale-95 disabled:opacity-50",
                selected.is_banned
                  ? "border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10"
                  : "border-red-500/40 text-red-300 hover:bg-red-500/10",
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
              className="rounded-lg border border-mcc-line bg-mcc-inset px-3 py-2 text-sm tabular-nums text-mcc-text placeholder:text-mcc-dim focus:outline-none"
            />
            <input
              value={usdt}
              onChange={(e) => setUsdt(e.target.value)}
              inputMode="decimal"
              placeholder="± USDT"
              className="rounded-lg border border-mcc-line bg-mcc-inset px-3 py-2 text-sm tabular-nums text-mcc-text placeholder:text-mcc-dim focus:outline-none"
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required — written to the audit log)"
              className="rounded-lg border border-mcc-line bg-mcc-inset px-3 py-2 text-sm text-mcc-text placeholder:text-mcc-dim focus:outline-none"
            />
            <button
              onClick={() => void adjust()}
              disabled={busy}
              className="rounded-lg bg-mcc-gold px-4 py-2 text-xs font-bold text-mcc-bg transition hover:bg-mcc-gold-bright active:scale-95 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-mcc-dim">
            Balances move only through the audited admin RPC (ledger entry + admin_actions row, same
            transaction). The reason is validated server-side; a blank reason is rejected.
          </p>
        </div>
      )}

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-mcc-line bg-mcc-surface">
        <table className="w-full min-w-[780px] border-collapse text-sm">
          <thead>
            <tr className="text-left">
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                User
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Telegram
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Coins
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                USDT
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Trust
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Status
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr
                key={u.id}
                onClick={() => setSelected(u)}
                className={cn(
                  "cursor-pointer border-b border-mcc-line/60 transition last:border-0 hover:bg-mcc-surface-2/70",
                  selected?.id === u.id && "bg-mcc-gold/[0.07] hover:bg-mcc-gold/[0.07]",
                )}
              >
                <td className="px-4 py-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-mcc-text">
                    <span className="truncate">{u.username ?? u.first_name ?? "anon"}</span>
                    {u.is_founder && <Crown className="h-3.5 w-3.5 shrink-0 text-mcc-gold-bright" />}
                    {u.is_admin && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-mcc-teal" />}
                  </p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-mcc-dim">
                    Lv.{u.level} · joined {new Date(u.created_at).toLocaleDateString()}
                  </p>
                </td>
                <td className="px-4 py-3 text-xs tabular-nums text-mcc-muted">
                  {u.telegram_id ?? "—"}
                </td>
                <td className="px-4 py-3 text-right text-xs font-medium tabular-nums text-mcc-text">
                  {formatCoins(u.coins)}
                </td>
                <td className="px-4 py-3 text-right text-xs font-medium tabular-nums text-mcc-text">
                  {formatUsdt(u.usdt_balance)}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-block rounded-full border border-mcc-teal/30 bg-mcc-teal/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-mcc-teal">
                    {u.trust_score}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.is_banned ? (
                    <span className="inline-block rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-300">
                      Banned
                    </span>
                  ) : (
                    <span className="inline-block rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <ChevronRight
                    className={cn(
                      "ml-auto h-4 w-4",
                      selected?.id === u.id ? "text-mcc-gold-bright" : "text-mcc-dim",
                    )}
                  />
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-mcc-dim">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
