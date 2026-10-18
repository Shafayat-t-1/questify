"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { adminFetch } from "@/lib/admin-client";
import { cn, formatUsdt } from "@/lib/utils";
import type { MccWithdrawal } from "./types";

type Filter = "pending" | "paid" | "rejected" | "all";

const FILTERS: Filter[] = ["pending", "paid", "rejected", "all"];

function statusPill(status: string): string {
  if (status === "pending") return "border-mcc-gold/40 bg-mcc-gold/10 text-mcc-gold-bright";
  if (status === "paid") return "border-emerald-400/40 bg-emerald-400/10 text-emerald-300";
  if (status === "rejected") return "border-red-400/40 bg-red-400/10 text-red-300";
  return "border-mcc-line-strong bg-white/5 text-mcc-muted";
}

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
        <div className="inline-flex rounded-lg border border-mcc-line bg-mcc-inset p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition",
                filter === f
                  ? "bg-mcc-gold/15 text-mcc-gold-bright"
                  : "text-mcc-dim hover:text-mcc-text",
              )}
            >
              {f}
              {f === "pending" && pendingCount > 0 && (
                <span className="ml-1.5 rounded-full bg-mcc-gold/20 px-1.5 text-[10px] font-bold tabular-nums text-mcc-gold-bright">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-mcc-dim">
          {rows.length} {filter === "all" ? "total" : filter}
        </span>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-mcc-line bg-mcc-surface">
        <table className="w-full min-w-[1040px] border-collapse text-sm">
          <thead>
            <tr className="text-left">
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Amount
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                User
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Network
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Address
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Created
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Status
              </th>
              <th className="sticky top-0 z-10 min-w-[300px] border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr
                key={w.id}
                className="border-b border-mcc-line/60 align-top transition last:border-0 hover:bg-mcc-surface-2/70"
              >
                <td className="px-4 py-3.5">
                  <p className="text-sm font-semibold tabular-nums text-mcc-text">
                    {formatUsdt(w.net_amount_usdt ?? w.amount_usdt)} USDT
                  </p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-mcc-dim">
                    gross {formatUsdt(w.amount_usdt)} · fee {formatUsdt(w.fee_usdt ?? 0)}
                  </p>
                </td>
                <td className="px-4 py-3.5">
                  <p className="text-xs font-medium text-mcc-text">{w.profiles?.username ?? "user"}</p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-mcc-dim">
                    {w.profiles?.telegram_id ? `tg ${w.profiles.telegram_id}` : "—"}
                  </p>
                </td>
                <td className="px-4 py-3.5">
                  <span className="inline-block rounded-full border border-mcc-line-strong bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-mcc-muted">
                    {w.network}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  <span
                    title={w.address}
                    className="block max-w-[200px] truncate font-mono text-[11px] text-mcc-muted"
                  >
                    {w.address}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-[11px] tabular-nums text-mcc-dim">
                  {new Date(w.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3.5">
                  <span
                    className={cn(
                      "inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                      statusPill(w.status),
                    )}
                  >
                    {w.status}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  {w.status === "pending" ? (
                    <div className="space-y-2">
                      <input
                        value={txHashes[w.id] ?? ""}
                        onChange={(e) => setTxHashes((prev) => ({ ...prev, [w.id]: e.target.value }))}
                        placeholder="On-chain tx hash (required to approve)"
                        className="w-full rounded-lg border border-mcc-line bg-mcc-inset px-3 py-2 font-mono text-[11px] text-mcc-text placeholder:text-mcc-dim focus:border-mcc-gold/50 focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => void update(w, "paid")}
                          disabled={busyId === w.id}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/25 active:scale-95 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve &amp; mark paid
                        </button>
                        <button
                          onClick={() => void update(w, "rejected")}
                          disabled={busyId === w.id}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-500/15 py-2 text-xs font-bold text-red-300 transition hover:bg-red-500/25 active:scale-95 disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reject (refunds user)
                        </button>
                      </div>
                    </div>
                  ) : w.tx_hash ? (
                    <a
                      href={`https://bscscan.com/tx/${w.tx_hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-mcc-teal hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> View transaction
                    </a>
                  ) : (
                    <span className="text-[11px] text-mcc-dim">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-mcc-dim">
                  No {filter === "all" ? "" : filter} payouts.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
