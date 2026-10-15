"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { adminFetch } from "@/lib/admin-client";
import { cn, formatUsdt } from "@/lib/utils";
import type { MccWithdrawal } from "./types";

type Filter = "pending" | "paid" | "rejected" | "all";

const FILTERS: Filter[] = ["pending", "paid", "rejected", "all"];

export function PayoutsPanel({
  withdrawals,
  onReload,
  notify,
}: {
  withdrawals: MccWithdrawal[];
  onReload: () => void;
  notify: (kind: "success" | "error", title: string, message: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [txHashes, setTxHashes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(
    () => withdrawals.filter((w) => (filter === "all" ? true : w.status === filter)),
    [withdrawals, filter],
  );
  const pendingCount = withdrawals.filter((w) => w.status === "pending").length;

  const update = async (w: MccWithdrawal, status: "paid" | "rejected") => {
    const txHash = (txHashes[w.id] ?? "").trim();
    if (status === "paid" && txHash.length < 4) {
      return notify("error", "Tx hash required", "Paste the on-chain transaction hash before approving.");
    }
    setBusyId(w.id);
    const res = await adminFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({
        action: "update_withdrawal",
        withdrawalId: w.id,
        status,
        tx_hash: txHash || undefined,
      }),
    });
    setBusyId(null);
    if (!res.ok) return notify("error", "Update failed", res.error ?? "failed");
    notify("success", `Withdrawal ${status}`, `${formatUsdt(w.net_amount_usdt ?? w.amount_usdt)} USDT`);
    onReload();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition",
              filter === f
                ? "border-neon-orange/50 bg-neon-orange/15 text-white"
                : "border-white/10 bg-white/[0.03] text-white/50",
            )}
          >
            {f}
            {f === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-400/20 px-1.5 text-[10px] text-amber-200">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {rows.length === 0 && (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] py-10 text-center text-xs text-white/40">
          No {filter === "all" ? "" : filter} payouts.
        </p>
      )}

      <div className="space-y-2.5">
        {rows.map((w) => (
          <div key={w.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">
                  {formatUsdt(w.net_amount_usdt ?? w.amount_usdt)} USDT
                  <span className="ml-2 text-[11px] font-normal text-white/45">{w.network}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-white/45">
                  Gross {formatUsdt(w.amount_usdt)} · fee {formatUsdt(w.fee_usdt ?? 0)} ·{" "}
                  {w.profiles?.username ?? "user"}
                  {w.profiles?.telegram_id ? ` (${w.profiles.telegram_id})` : ""}
                </p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-white/35">{w.address}</p>
                <p className="mt-0.5 text-[10px] text-white/30">
                  {new Date(w.created_at).toLocaleString()}
                  {w.tx_hash ? ` · tx ${w.tx_hash.slice(0, 14)}…` : ""}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  w.status === "pending" && "border-amber-400/40 bg-amber-400/10 text-amber-200",
                  w.status === "paid" && "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
                  w.status === "rejected" && "border-red-400/40 bg-red-400/10 text-red-200",
                  !["pending", "paid", "rejected"].includes(w.status) &&
                    "border-white/15 bg-white/5 text-white/50",
                )}
              >
                {w.status}
              </span>
            </div>

            {w.status === "pending" && (
              <>
                <input
                  value={txHashes[w.id] ?? ""}
                  onChange={(e) => setTxHashes((prev) => ({ ...prev, [w.id]: e.target.value }))}
                  placeholder="On-chain tx hash (required to approve)"
                  className="mt-3 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 font-mono text-[11px] text-white placeholder:text-white/30 focus:border-neon-orange/40 focus:outline-none"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void update(w, "paid")}
                    disabled={busyId === w.id}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500/20 py-2 text-xs font-bold text-emerald-300 transition active:scale-95 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve &amp; mark paid
                  </button>
                  <button
                    onClick={() => void update(w, "rejected")}
                    disabled={busyId === w.id}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500/20 py-2 text-xs font-bold text-red-300 transition active:scale-95 disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Reject (refunds user)
                  </button>
                </div>
              </>
            )}

            {w.status !== "pending" && w.tx_hash && (
              <a
                href={`https://bscscan.com/tx/${w.tx_hash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-neon-cyan/80 hover:text-neon-cyan"
              >
                <ExternalLink className="h-3 w-3" /> View transaction
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
