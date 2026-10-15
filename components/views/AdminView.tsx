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
  Search,
  Send,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { authHeaders } from "@/lib/session-client";
import { useQuestify } from "@/providers/QuestifyProvider";
import { useTelegram } from "@/hooks/useTelegram";
import { cn, formatCoins, formatUsdt } from "@/lib/utils";

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
  level: number;
  is_banned: boolean | null;
  is_admin: boolean | null;
  created_at: string;
}
interface AdminWithdrawal {
  id: string;
  amount_usdt: number;
  network: string;
  address: string;
  status: string;
  created_at: string;
  profiles?: { username?: string | null; telegram_id?: number | string | null };
}
interface AdminSetting {
  key: string;
  value: unknown;
  is_public: boolean | null;
  description: string | null;
}
interface AdminData {
  stats: AdminStats;
  users: AdminUser[];
  withdrawals: AdminWithdrawal[];
  settings?: AdminSetting[];
}

type Panel = "overview" | "users" | "withdrawals" | "broadcast" | "settings";

interface SettingField {
  key: string;
  label: string;
  kind: "number" | "numbers" | "text";
  hint?: string;
}

const SETTING_FIELDS: SettingField[] = [
  { key: "referral_commission_pct", label: "Referral commission (fraction)", kind: "number", hint: "0.1 = 10%" },
  { key: "referral_signup_reward_coins", label: "Referral signup reward (coins)", kind: "number" },
  { key: "referral_signup_reward_usdt", label: "Referral signup reward (USDT)", kind: "number" },
  { key: "coin_to_usdt_rate", label: "Coin→USDT rate", kind: "number" },
  { key: "withdrawal_fee_bep20", label: "BEP-20 withdrawal fee (USDT)", kind: "number" },
  { key: "withdrawal_fee_ton", label: "TON withdrawal fee (USDT)", kind: "number" },
  { key: "checkin_reward_schedule", label: "Check-in rewards (7, comma-separated)", kind: "numbers" },
  { key: "checkin_multiplier_schedule", label: "Check-in multipliers (7, comma-separated)", kind: "numbers" },
  { key: "level_coins_per_level", label: "Coins per level", kind: "number" },
  { key: "trust_score_task_delta", label: "Trust gain per task", kind: "number" },
  { key: "trust_score_checkin_delta", label: "Trust gain per check-in", kind: "number" },
  { key: "trust_score_cap", label: "Trust score cap", kind: "number" },
  { key: "trust_threshold_for_withdrawal", label: "Min trust to withdraw", kind: "number" },
  { key: "min_withdrawal_usdt", label: "Minimum withdrawal (USDT)", kind: "number" },
  { key: "leaderboard_season_label", label: "Leaderboard season label", kind: "text" },
  { key: "leaderboard_reset_label", label: "Leaderboard reset label", kind: "text" },
  { key: "leaderboard_reward_note", label: "Leaderboard reward note", kind: "text" },
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

function StatCard({
  label,
  value,
  Icon,
  tint,
}: {
  label: string;
  value: string;
  Icon: React.ElementType;
  tint: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 backdrop-blur-xl">
      <Icon className={cn("h-4 w-4", tint)} />
      <p className="mt-2 text-lg font-bold tracking-tight text-white">{value}</p>
      <p className="text-[11px] text-white/45">{label}</p>
    </div>
  );
}

export function AdminView() {
  const { actions } = useQuestify();
  const { haptic } = useTelegram();
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("overview");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUser[]>([]);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [adjustCoins, setAdjustCoins] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [busy, setBusy] = useState(false);

  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastProgress, setBroadcastProgress] = useState<string | null>(null);
  const [txHashes, setTxHashes] = useState<Record<string, string>>({});
  const [settingEdits, setSettingEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await adminFetch<AdminData>("/api/admin");
    if (!res.ok || !res.data) {
      setError(res.error ?? "failed");
      setLoading(false);
      return;
    }
    setError(null);
    setData(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res = await adminFetch<AdminData>("/api/admin");
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
  }, []);

  const toast = useCallback(
    (title: string, message: string, kind: "success" | "error" = "success") =>
      actions.pushToast({ kind, title, message }),
    [actions],
  );

  const runLookup = async () => {
    if (!query.trim()) return;
    haptic("light");
    const res = await adminFetch<AdminUser[]>("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "lookup_user", query: query.trim() }),
    });
    if (!res.ok) return toast("Lookup failed", res.error ?? "failed", "error");
    setResults(res.data ?? []);
  };

  const toggleBan = async (user: AdminUser) => {
    haptic("medium");
    const res = await adminFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "update_user", userId: user.id, is_banned: !user.is_banned }),
    });
    if (!res.ok) return toast("Update failed", res.error ?? "failed", "error");
    toast(user.is_banned ? "User unbanned" : "User banned", user.username ?? "user");
    setSelected({ ...user, is_banned: !user.is_banned });
    setResults((prev) => prev.map((u) => (u.id === user.id ? { ...u, is_banned: !u.is_banned } : u)));
  };

  const applyAdjustment = async () => {
    if (!selected) return;
    const delta = Number.parseInt(adjustCoins, 10);
    if (!Number.isFinite(delta) || delta === 0) return toast("Enter a coin delta", "e.g. 1000 or -500", "error");
    setBusy(true);
    haptic("medium");
    const res = await adminFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({
        action: "adjust_balance",
        userId: selected.id,
        delta_coins: delta,
        reason: adjustReason.trim() || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) return toast("Adjustment failed", res.error ?? "failed", "error");
    toast("Balance adjusted", `${delta > 0 ? "+" : ""}${delta} coins`);
    setAdjustCoins("");
    setAdjustReason("");
  };

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
    toast(`Withdrawal ${status}`, `${formatUsdt(w.amount_usdt)} USDT`);
    setData((prev) =>
      prev
        ? { ...prev, withdrawals: prev.withdrawals.map((x) => (x.id === w.id ? { ...x, status } : x)) }
        : prev,
    );
  };

  const saveSetting = async (field: SettingField) => {
    const current = data?.settings?.find((s) => s.key === field.key)?.value;
    const raw = settingEdits[field.key];
    if (raw === undefined) return;
    let value: unknown;
    if (field.kind === "number") {
      value = Number(raw);
      if (!Number.isFinite(value)) return toast("Invalid value", `${field.label} must be a number`, "error");
    } else if (field.kind === "numbers") {
      value = raw
        .split(",")
        .map((p) => Number(p.trim()))
        .filter((n) => Number.isFinite(n));
      if ((value as number[]).length === 0)
        return toast("Invalid value", "Enter comma-separated numbers", "error");
    } else {
      value = raw.trim();
      if (!value) return toast("Invalid value", "Value cannot be empty", "error");
    }
    if (JSON.stringify(value) === JSON.stringify(current)) return;
    setSavingKey(field.key);
    const res = await adminFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "update_settings", key: field.key, value }),
    });
    setSavingKey(null);
    if (!res.ok) return toast("Save failed", res.error ?? "failed", "error");
    toast("Setting saved", field.label);
    setData((prev) =>
      prev
        ? {
            ...prev,
            settings: (prev.settings ?? []).map((s) =>
              s.key === field.key ? { ...s, value } : s,
            ),
          }
        : prev,
    );
  };

  const sendBroadcast = async () => {
    const message = broadcastMsg.trim();
    if (!message) return toast("Message required", "Type a broadcast first", "error");
    setBusy(true);
    let offset = 0;
    let sent = 0;
    let done = false;
    while (!done) {
      const res = await adminFetch<{ processed: number; sent: number; nextOffset: number; done: boolean }>(
        "/api/admin",
        { method: "POST", body: JSON.stringify({ action: "broadcast", message, offset }) },
      );
      if (!res.ok || !res.data) {
        setBusy(false);
        return toast("Broadcast failed", res.error ?? "failed", "error");
      }
      offset = res.data.nextOffset;
      sent += res.data.sent;
      done = res.data.done;
      setBroadcastProgress(`Sent to ${sent} users…`);
    }
    setBusy(false);
    setBroadcastProgress(null);
    setBroadcastMsg("");
    haptic("heavy");
    toast("Broadcast complete", `${sent} messages delivered`);
  };

  const pending = useMemo(
    () => (data?.withdrawals ?? []).filter((w) => w.status === "pending"),
    [data],
  );

  const PANELS: { key: Panel; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "users", label: "Users" },
    { key: "withdrawals", label: "Payouts" },
    { key: "broadcast", label: "Broadcast" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="px-4 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
          <ShieldCheck className="h-5 w-5 text-neon-orange" /> Admin
        </h1>
        <button
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/60 transition active:scale-95"
          aria-label="Refresh"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
        {PANELS.map((p) => (
          <button
            key={p.key}
            onClick={() => {
              haptic("light");
              setPanel(p.key);
            }}
            className={cn(
              "relative shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition",
              panel === p.key
                ? "border-neon-orange/50 bg-neon-orange/15 text-white"
                : "border-white/10 bg-white/[0.03] text-white/50",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          {error === "forbidden" ? "You do not have admin access." : `Admin error: ${error}`}
        </div>
      )}

      {loading && !data ? (
        <div className="mt-4 grid place-items-center py-16">
          <RefreshCw className="h-5 w-5 animate-spin text-neon-orange" />
        </div>
      ) : data ? (
        <motion.div
          key={panel}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-4"
        >
          {panel === "overview" && (
            <div className="grid grid-cols-2 gap-2.5">
              <StatCard label="Total users" value={String(data.stats.totalUsers)} Icon={Users} tint="text-neon-cyan" />
              <StatCard
                label="Tasks completed"
                value={String(data.stats.totalTasksCompleted)}
                Icon={CheckCircle2}
                tint="text-emerald-300"
              />
              <StatCard
                label="Pending payouts"
                value={String(data.stats.pendingWithdrawals)}
                Icon={Gauge}
                tint="text-amber-300"
              />
              <StatCard
                label="Total paid out"
                value={`${formatUsdt(data.stats.totalPaidOut)}`}
                Icon={Coins}
                tint="text-neon-orange"
              />
            </div>
          )}

          {panel === "users" && (
            <div>
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void runLookup()}
                  placeholder="Search username or telegram id"
                  className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none"
                />
                <button
                  onClick={() => void runLookup()}
                  className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-gradient-to-br from-neon-orange to-amber-500 text-black transition active:scale-95"
                  aria-label="Search"
                >
                  <Search className="h-4 w-4" />
                </button>
              </div>

              {selected && (
                <div className="mt-3 rounded-2xl border border-neon-orange/30 bg-neon-orange/[0.06] p-3.5">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {selected.username ?? selected.first_name ?? "user"}
                      </p>
                      <p className="text-[11px] text-white/45">
                        {formatCoins(selected.coins)} coins · {formatUsdt(selected.usdt_balance)} USDT
                      </p>
                    </div>
                    <button
                      onClick={() => void toggleBan(selected)}
                      className={cn(
                        "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold",
                        selected.is_banned
                          ? "border-emerald-400/40 text-emerald-300"
                          : "border-red-500/40 text-red-300",
                      )}
                    >
                      <Ban className="h-3 w-3" /> {selected.is_banned ? "Unban" : "Ban"}
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={adjustCoins}
                      onChange={(e) => setAdjustCoins(e.target.value)}
                      inputMode="numeric"
                      placeholder="± coins"
                      className="w-24 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
                    />
                    <input
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      placeholder="reason (optional)"
                      className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
                    />
                    <button
                      onClick={() => void applyAdjustment()}
                      disabled={busy}
                      className="rounded-xl bg-neon-orange px-3 py-2 text-xs font-bold text-black transition active:scale-95 disabled:opacity-50"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-3 space-y-2">
                {(results.length ? results : data.users.slice(0, 25)).map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setSelected(u)}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition active:scale-[0.99]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {u.username ?? u.first_name ?? "anon"}
                        {u.is_banned && <span className="ml-2 text-[10px] font-bold text-red-400">BANNED</span>}
                      </p>
                      <p className="text-[11px] text-white/45">
                        {formatCoins(u.coins)} coins · {formatUsdt(u.usdt_balance)} USDT · trust {u.trust_score}
                      </p>
                    </div>
                    <span className="text-[10px] text-white/30">{u.telegram_id ?? "—"}</span>
                  </button>
                ))}
                {results.length === 0 && query && (
                  <p className="py-6 text-center text-xs text-white/40">No users found.</p>
                )}
              </div>
            </div>
          )}

          {panel === "withdrawals" && (
            <div className="space-y-2">
              {pending.length === 0 && (
                <p className="py-8 text-center text-xs text-white/40">No pending payouts.</p>
              )}
              {pending.map((w) => (
                <div key={w.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">{formatUsdt(w.amount_usdt)} USDT</p>
                    <span className="text-[11px] text-white/45">{w.network}</span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-white/40">
                    {w.profiles?.username ?? "user"} · {w.address}
                  </p>
                  <input
                    value={txHashes[w.id] ?? ""}
                    onChange={(e) => setTxHashes((prev) => ({ ...prev, [w.id]: e.target.value }))}
                    placeholder="On-chain tx hash (required to approve)"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:outline-none"
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

          {panel === "broadcast" && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
                <Megaphone className="h-4 w-4 text-neon-orange" /> Broadcast to all users
              </p>
              <textarea
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
                rows={5}
                placeholder="Write an announcement…"
                className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white placeholder:text-white/30 focus:outline-none"
              />
              <button
                onClick={() => void sendBroadcast()}
                disabled={busy}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-neon-orange to-amber-500 py-2.5 text-sm font-bold text-black transition active:scale-[0.99] disabled:opacity-50"
              >
                <Send className="h-4 w-4" /> {busy ? broadcastProgress ?? "Sending…" : "Send broadcast"}
              </button>
            </div>
          )}

          {panel === "settings" && (
            <div className="space-y-3">
              <p className="text-[11px] text-white/45">
                Business rules live in the database — changes take effect on the next request,
                no redeploy. Amounts are read server-side and are authoritative.
              </p>
              {SETTING_FIELDS.map((field) => {
                const current = data.settings?.find((s) => s.key === field.key)?.value;
                const display =
                  settingEdits[field.key] ??
                  (Array.isArray(current) ? current.join(", ") : current === undefined ? "" : String(current));
                return (
                  <div key={field.key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                    <label className="text-[11px] font-medium text-white/70">{field.label}</label>
                    {field.hint && <span className="ml-1 text-[10px] text-white/35">({field.hint})</span>}
                    <div className="mt-2 flex gap-2">
                      <input
                        value={display}
                        onChange={(e) =>
                          setSettingEdits((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        inputMode={field.kind === "text" ? "text" : "decimal"}
                        className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
                      />
                      <button
                        onClick={() => void saveSetting(field)}
                        disabled={savingKey === field.key}
                        className="rounded-xl bg-gradient-to-br from-neon-orange to-amber-500 px-3 text-xs font-bold text-black transition active:scale-95 disabled:opacity-50"
                      >
                        {savingKey === field.key ? "…" : "Save"}
                      </button>
                    </div>
                    {current === undefined && (
                      <p className="mt-1 text-[10px] text-amber-300/70">
                        Not in DB yet — saving will create it.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      ) : null}
    </div>
  );
}
