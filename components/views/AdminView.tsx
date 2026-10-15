"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Ban,
  CheckCircle2,
  Coins,
  Gauge,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  XCircle,
} from "lucide-react";
import { authHeaders } from "@/lib/session-client";
import { useQuestify } from "@/providers/QuestifyProvider";
import { useTelegram } from "@/hooks/useTelegram";
import { cn, formatCoins, formatUsdt } from "@/lib/utils";

/**
 * In-app Quick Panel (trimmed in Phase 3A).
 *
 * The Mini App keeps only the three things worth doing on a phone:
 *   · approve / reject pending withdrawals (with the required tx hash)
 *   · ban / unban a user
 *   · a glance at both platform wallet balances
 *
 * Everything deeper — user search & manual balance adjustment, task CRUD,
 * business settings, broadcast, audit log — lives in the standalone control
 * center at /mcc (full-width, cookie-authenticated, open in a browser).
 */

interface AdminStats {
  totalUsers: number;
  totalTasksCompleted: number;
  pendingWithdrawals: number;
  totalPaidOut: number;
}
interface AdminUser {
  id: string;
  username: string | null;
  first_name: string | null;
  telegram_id: number | string | null;
  coins: number;
  usdt_balance: number;
  trust_score: number;
  is_banned: boolean | null;
}
interface AdminWithdrawal {
  id: string;
  amount_usdt: number;
  fee_usdt?: number;
  net_amount_usdt?: number;
  network: string;
  address: string;
  status: string;
  created_at: string;
  profiles?: { username?: string | null; telegram_id?: number | string | null };
}
interface AdminWallet {
  balance: number;
}
interface AdminData {
  stats: AdminStats;
  users: AdminUser[];
  withdrawals: AdminWithdrawal[];
  wallets?: { owner: AdminWallet; marketing: AdminWallet };
}

type Panel = "payouts" | "users";

const PANELS: { key: Panel; label: string }[] = [
  { key: "payouts", label: "Payouts" },
  { key: "users", label: "Users" },
];

async function adminFetch<T>(
  path: string,
  init?: RequestInit & { body?: string },
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
    });
    return (await res.json()) as { ok: boolean; data?: T; error?: string };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export function AdminView() {
  const { config, actions } = useQuestify();
  const { haptic } = useTelegram();
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("payouts");
  const [txHashes, setTxHashes] = useState<Record<string, string>>({});

  const toast = useCallback(
    (title: string, message: string, kind: "success" | "error" = "success") =>
      actions.pushToast({ kind, title, message }),
    [actions],
  );

  const fetchData = useCallback(() => adminFetch<AdminData>("/api/admin"), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetchData();
    if (!res.ok || !res.data) {
      setError(res.error ?? "failed");
      setLoading(false);
      return;
    }
    setError(null);
    setData(res.data);
    setLoading(false);
  }, [fetchData]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res = await fetchData();
      if (cancelled) return;
      if (!res.ok || !res.data) {
        setError(res.error ?? "failed");
        setLoading(false);
        return;
      }
      setError(null);
      setData(res.data);
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [fetchData]);

  const updateWithdrawal = async (w: AdminWithdrawal, status: "paid" | "rejected") => {
    const txHash = (txHashes[w.id] ?? "").trim();
    if (status === "paid" && txHash.length < 4) {
      return toast("Tx hash required", "Paste the on-chain transaction hash before approving", "error");
    }
    haptic("medium");
    const res = await adminFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({
        action: "update_withdrawal",
        withdrawalId: w.id,
        status,
        tx_hash: txHash || undefined,
      }),
    });
    if (!res.ok) return toast("Update failed", res.error ?? "failed", "error");
    toast(`Withdrawal ${status}`, `${formatUsdt(w.net_amount_usdt ?? w.amount_usdt)} USDT`);
    setData((prev) =>
      prev
        ? { ...prev, withdrawals: prev.withdrawals.map((x) => (x.id === w.id ? { ...x, status } : x)) }
        : prev,
    );
  };

  const toggleBan = async (user: AdminUser) => {
    haptic("medium");
    const res = await adminFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "update_user", userId: user.id, is_banned: !user.is_banned }),
    });
    if (!res.ok) return toast("Update failed", res.error ?? "failed", "error");
    toast(user.is_banned ? "User unbanned" : "User banned", user.username ?? "user");
    setData((prev) =>
      prev
        ? { ...prev, users: prev.users.map((u) => (u.id === user.id ? { ...u, is_banned: !u.is_banned } : u)) }
        : prev,
    );
  };

  const pending = useMemo(
    () => (data?.withdrawals ?? []).filter((w) => w.status === "pending"),
    [data],
  );

  return (
    <div className="px-4 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
          <ShieldCheck className="h-5 w-5 text-neon-orange" /> Quick Panel
        </h1>
        <button
          onClick={() => void refresh()}
          className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/60 transition active:scale-95"
          aria-label="Refresh"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          {error === "forbidden" ? "You do not have admin access." : `Admin error: ${error}`}
        </div>
      )}

      {data && (
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <Coins className="h-4 w-4 text-emerald-300" />
            <p className="mt-2 text-lg font-bold tracking-tight text-white">
              {formatUsdt(data.wallets?.owner.balance ?? 0)}
            </p>
            <p className="text-[11px] text-white/45">Owner wallet (USDT)</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <Megaphone className="h-4 w-4 text-neon-cyan" />
            <p className="mt-2 text-lg font-bold tracking-tight text-white">
              {formatUsdt(data.wallets?.marketing.balance ?? 0)}
            </p>
            <p className="text-[11px] text-white/45">Marketing wallet (USDT)</p>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="mt-4 grid place-items-center py-16">
          <RefreshCw className="h-5 w-5 animate-spin text-neon-orange" />
        </div>
      ) : data ? (
        <>
          <div className="mt-4 flex gap-1.5">
            {PANELS.map((p) => (
              <button
                key={p.key}
                onClick={() => {
                  haptic("light");
                  setPanel(p.key);
                }}
                className={cn(
                  "relative rounded-full border px-3.5 py-1.5 text-xs font-semibold transition",
                  panel === p.key
                    ? "border-neon-orange/50 bg-neon-orange/15 text-white"
                    : "border-white/10 bg-white/[0.03] text-white/50",
                )}
              >
                {p.label}
                {p.key === "payouts" && pending.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-amber-400/25 px-1.5 text-[10px] text-amber-100">
                    {pending.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <motion.div
            key={panel}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-4"
          >
            {panel === "payouts" && (
              <div className="space-y-2.5">
                {pending.length === 0 && (
                  <p className="py-8 text-center text-xs text-white/40">No pending payouts.</p>
                )}
                {pending.map((w) => (
                  <div key={w.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-white">
                        {formatUsdt(w.net_amount_usdt ?? w.amount_usdt)} USDT
                      </p>
                      <span className="text-[11px] text-white/45">
                        {w.network} · fee {formatUsdt(w.fee_usdt ?? 0)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-white/40">
                      {w.profiles?.username ?? "user"} · {w.address}
                    </p>
                    <input
                      value={txHashes[w.id] ?? ""}
                      onChange={(e) => setTxHashes((prev) => ({ ...prev, [w.id]: e.target.value }))}
                      placeholder="On-chain tx hash (required to approve)"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 font-mono text-[11px] text-white placeholder:text-white/30 focus:outline-none"
                    />
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => void updateWithdrawal(w, "paid")}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-500/20 py-2 text-xs font-bold text-emerald-300 transition active:scale-95"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </button>
                      <button
                        onClick={() => void updateWithdrawal(w, "rejected")}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-red-500/20 py-2 text-xs font-bold text-red-300 transition active:scale-95"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {panel === "users" && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-white/45">
                  <Gauge className="h-3.5 w-3.5 text-neon-orange" />
                  {data.stats.totalUsers.toLocaleString()} users · recent first. Search &amp; full
                  edits live in the control center.
                </p>
                {data.users.slice(0, 30).map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {u.username ?? u.first_name ?? "anon"}
                        {u.is_banned && (
                          <span className="ml-2 text-[10px] font-bold text-red-400">BANNED</span>
                        )}
                      </p>
                      <p className="text-[11px] text-white/45">
                        {formatCoins(u.coins)} coins · {formatUsdt(u.usdt_balance)} USDT · trust{" "}
                        {u.trust_score}
                      </p>
                    </div>
                    <button
                      onClick={() => void toggleBan(u)}
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition active:scale-95",
                        u.is_banned
                          ? "border-emerald-400/40 text-emerald-300"
                          : "border-red-500/40 text-red-300",
                      )}
                    >
                      {u.is_banned ? <UserCheck className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                      {u.is_banned ? "Unban" : "Ban"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          <p className="mt-4 text-center text-[10px] leading-relaxed text-white/30">
            Full control room (users, tasks, settings, broadcast, audit):{" "}
            <span className="font-mono text-white/45">{config.appUrl}/mcc</span> — open it in a
            browser and sign in with Telegram.
          </p>
        </>
      ) : null}
    </div>
  );
}
