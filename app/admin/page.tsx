"use client";

import { useCallback, useEffect, useState } from "react";
import {
  authHeaders,
  getSessionToken,
  setInitData,
  setSessionToken,
} from "@/lib/session-client";
import { isSupabaseConfigured } from "@/lib/supabase";
import { formatUsdt } from "@/lib/utils";

interface AdminStats {
  totalUsers: number;
  totalTasksCompleted: number;
  pendingWithdrawals: number;
  totalPaidOut: number;
  totalActiveUsers: number;
  platformLiquidity: number;
}

interface WalletView {
  balance: number;
  entries: Array<Record<string, unknown>>;
}

interface AdminData {
  stats: AdminStats;
  users: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  withdrawals: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  wallets?: { owner: WalletView; marketing: WalletView };
}

type AuthState = "checking" | "ready" | "outside-telegram" | "error";

async function fetchAdminData(): Promise<AdminData> {
  const res = await fetch("/api/admin", { headers: { ...authHeaders() } });
  const json = (await res.json()) as { ok?: boolean; data?: AdminData; error?: string };
  if (!res.ok || !json.ok) throw new Error(json.error || "failed");
  return json.data as AdminData;
}

async function adminAction(action: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ action, ...params }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: unknown; error?: string };
  if (!res.ok || !json.ok) throw new Error(json.error || "request_failed");
  return json.data;
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [tab, setTab] = useState<"tasks" | "withdrawals" | "users" | "broadcast" | "stats">(
    "stats",
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchAdminData());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // Bootstrap a verified Telegram session from the Mini App `initData`, then
  // load the first page of admin data. All state writes happen after an await so
  // nothing renders in a synchronous effect tick.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!isSupabaseConfigured) {
          if (active) setAuthState("error");
          return;
        }
        if (!getSessionToken()) {
          const initData = window.Telegram?.WebApp?.initData ?? "";
          if (!initData) {
            if (active) setAuthState("outside-telegram");
            return;
          }
          const res = await fetch("/api/telegram-auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData }),
          });
          const json = (await res.json()) as { ok?: boolean; token?: string; error?: string };
          if (!res.ok || !json.ok || !json.token) throw new Error(json.error || "auth_failed");
          setSessionToken(json.token);
          setInitData(initData);
        }

        const first = await fetchAdminData().catch((e: unknown) => {
          throw e instanceof Error ? e : new Error("failed");
        });
        if (active) {
          setData(first);
          setError(null);
          setLoading(false);
          setAuthState("ready");
        }
      } catch (e: unknown) {
        if (active) {
          setError(e instanceof Error ? e.message : "failed");
          setLoading(false);
          setAuthState("error");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!isSupabaseConfigured) {
    return <AdminNotice>Admin requires Supabase configuration.</AdminNotice>;
  }

  if (authState === "checking") {
    return <AdminNotice>Verifying Telegram session…</AdminNotice>;
  }

  if (authState === "outside-telegram") {
    return (
      <AdminNotice>
        Please open the Questify Mini App inside Telegram to access the admin panel.
      </AdminNotice>
    );
  }

  if (authState === "error") {
    return (
      <AdminNotice>
        Could not verify your Telegram session. Reopen Questify in Telegram.
        {error ? <div className="mt-2 text-xs text-red-400">{error}</div> : null}
      </AdminNotice>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0B0E14] text-white p-4">
      <h1 className="text-2xl font-bold mb-4">Super Admin Dashboard</h1>
      {error && <div className="mb-4 rounded bg-red-900/40 border border-red-500/50 p-3">{error}</div>}
      {loading && <div>Loading...</div>}
      {data && (
        <div>
          <div className="flex gap-2 mb-4 flex-wrap">
            {(["stats", "tasks", "withdrawals", "users", "broadcast"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded border ${tab === t ? "border-orange-500" : "border-white/20"}`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          {tab === "stats" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Total Users" value={data.stats.totalUsers} />
                <StatCard label="Tasks Completed" value={data.stats.totalTasksCompleted} />
                <StatCard label="Pending Withdrawals" value={data.stats.pendingWithdrawals} />
                <StatCard label="Total Paid Out" value={`${formatUsdt(data.stats.totalPaidOut)} USDT`} />
                <StatCard label="Total Active Users" value={data.stats.totalActiveUsers} />
                <StatCard label="Platform Liquidity" value={`${formatUsdt(data.stats.platformLiquidity)} USDT`} />
                <StatCard
                  label="Owner Wallet"
                  value={`${formatUsdt(data.wallets?.owner.balance ?? 0)} USDT`}
                />
                <StatCard
                  label="Marketing Wallet"
                  value={`${formatUsdt(data.wallets?.marketing.balance ?? 0)} USDT`}
                />
              </div>
              <WalletLedger title="Owner wallet · recent entries" entries={data.wallets?.owner.entries ?? []} />
              <WalletLedger title="Marketing wallet · recent entries" entries={data.wallets?.marketing.entries ?? []} />
            </div>
          )}
          {tab === "tasks" && <TasksManager tasks={data.tasks} onRefresh={refresh} />}
          {tab === "withdrawals" && <WithdrawalsManager withdrawals={data.withdrawals} onRefresh={refresh} />}
          {tab === "users" && <UsersManager users={data.users} onRefresh={refresh} />}
          {tab === "broadcast" && <BroadcastManager />}
        </div>
      )}
    </div>
  );
}

function AdminNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex items-center justify-center p-4 text-white">
      <div className="max-w-md rounded-lg border border-white/10 p-6 text-center">{children}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-white/10 p-4">
      <div className="text-xs text-white/60">{label}</div>
      <div className="text-lg font-semibold">{value as React.ReactNode}</div>
    </div>
  );
}

function WalletLedger({
  title,
  entries,
}: {
  title: string;
  entries: Array<Record<string, unknown>>;
}) {
  return (
    <div className="rounded-lg border border-white/10 p-3">
      <div className="mb-2 text-xs text-white/60">{title}</div>
      {entries.length === 0 && <div className="text-xs text-white/40">No entries yet.</div>}
      <div className="space-y-1">
        {entries.map((e) => (
          <div key={String(e.id)} className="flex justify-between text-xs">
            <span className="text-white/60">{String(e.type)}</span>
            <span className={Number(e.amount_usdt) < 0 ? "text-red-300" : "text-emerald-300"}>
              {Number(e.amount_usdt) >= 0 ? "+" : ""}
              {formatUsdt(Number(e.amount_usdt))} → {formatUsdt(Number(e.balance_after))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TasksManager({
  tasks,
  onRefresh,
}: {
  tasks: Array<Record<string, unknown>>;
  onRefresh: () => void;
}) {
  const [form, setForm] = useState<Record<string, unknown>>({ is_active: true });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await adminAction("upsert_task", { p_task_id: editing || null, ...form });
      setEditing(null);
      setForm({ is_active: true });
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: string) => {
    await adminAction("delete_task", { taskId: id });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/10 p-4 space-y-2">
        <h3 className="font-semibold">{editing ? "Edit Task" : "Add Task"}</h3>
        <input className="bg-black/30 border border-white/10 rounded px-2 py-1 w-full" placeholder="Title" value={(form.title as string) || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input className="bg-black/30 border border-white/10 rounded px-2 py-1 w-full" placeholder="Platform (telegram/x/youtube/tiktok/github/reddit/discord)" value={(form.platform as string) || ""} onChange={(e) => setForm({ ...form, platform: e.target.value })} />
        <input className="bg-black/30 border border-white/10 rounded px-2 py-1 w-full" placeholder="Action URL" value={(form.action_url as string) || ""} onChange={(e) => setForm({ ...form, action_url: e.target.value })} />
        <input className="bg-black/30 border border-white/10 rounded px-2 py-1 w-full" placeholder="Action Label" value={(form.action_label as string) || ""} onChange={(e) => setForm({ ...form, action_label: e.target.value })} />
        <div className="flex gap-2">
          <input className="bg-black/30 border border-white/10 rounded px-2 py-1 flex-1" type="number" placeholder="Coins" value={(form.reward_coins as number) || 0} onChange={(e) => setForm({ ...form, reward_coins: Number(e.target.value) })} />
          <input className="bg-black/30 border border-white/10 rounded px-2 py-1 flex-1" type="number" step="0.01" placeholder="USDT" value={(form.reward_usdt as number) || 0} onChange={(e) => setForm({ ...form, reward_usdt: Number(e.target.value) })} />
          <input className="bg-black/30 border border-white/10 rounded px-2 py-1 flex-1" type="number" step="0.01" placeholder="Owner margin (USDT)" value={(form.margin_usdt as number) || 0} onChange={(e) => setForm({ ...form, margin_usdt: Number(e.target.value) })} />
        </div>
        <button disabled={busy} className="px-3 py-1 rounded bg-orange-600 disabled:opacity-50" onClick={submit}>{editing ? "Update" : "Add"}</button>
      </div>
      <div className="space-y-2">
        {tasks.map((t: Record<string, unknown>) => (
          <div key={t.id as string} className="rounded-lg border border-white/10 p-3 flex justify-between items-center">
            <div>
              <div className="font-medium">{String(t.title)} ({String(t.platform)})</div>
              <div className="text-xs text-white/60">{Number(t.reward_coins)} coins / {formatUsdt(Number(t.reward_usdt))} USDT · {Boolean(t.is_active) ? "active" : "inactive"}</div>
            </div>
            <div className="flex gap-2">
              <button className="px-2 py-1 border border-white/20 rounded text-xs" onClick={() => { setEditing(t.id as string); setForm({ ...(t as Record<string, unknown>) }); }}>Edit</button>
              <button className="px-2 py-1 border border-red-500/50 rounded text-xs" onClick={() => del(t.id as string)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WithdrawalsManager({
  withdrawals,
  onRefresh,
}: {
  withdrawals: Array<Record<string, unknown>>;
  onRefresh: () => void;
}) {
  const [txHashes, setTxHashes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const update = async (id: string, status: string) => {
    const txHash = (txHashes[id] ?? "").trim();
    if (status === "paid" && txHash.length < 4) {
      setError("A tx hash is required before approving a payout.");
      return;
    }
    setError(null);
    try {
      await adminAction("update_withdrawal", { withdrawalId: id, status, tx_hash: txHash || undefined });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed");
    }
  };

  return (
    <div className="space-y-2">
      {error && <div className="rounded bg-red-900/40 border border-red-500/50 p-2 text-sm">{error}</div>}
      {withdrawals.map((w: Record<string, unknown>) => (
        <div key={w.id as string} className="rounded-lg border border-white/10 p-3 space-y-2">
          <div className="flex justify-between items-center">
            <div>
              <div className="font-medium">
                {formatUsdt(Number(w.net_amount_usdt ?? w.amount_usdt))} USDT payout via {String(w.network)}
              </div>
              <div className="text-xs text-white/60">
                Gross {formatUsdt(Number(w.amount_usdt))} · fee {formatUsdt(Number(w.fee_usdt ?? 0))} · User: {String(((w.profiles as Record<string, unknown>)?.username) || w.user_id)} · Status: {String(w.status)}
              </div>
              <div className="text-xs text-white/40 truncate">{String(w.address)}</div>
            </div>
            <div className="flex gap-2">
              {String(w.status) === "pending" && (
                <>
                  <button className="px-2 py-1 border border-green-500/50 rounded text-xs" onClick={() => update(w.id as string, "paid")}>Approve</button>
                  <button className="px-2 py-1 border border-red-500/50 rounded text-xs" onClick={() => update(w.id as string, "rejected")}>Reject</button>
                </>
              )}
            </div>
          </div>
          {String(w.status) === "pending" && (
            <input
              className="bg-black/30 border border-white/10 rounded px-2 py-1 w-full text-xs"
              placeholder="On-chain tx hash (required to approve)"
              value={txHashes[w.id as string] ?? ""}
              onChange={(e) => setTxHashes((prev) => ({ ...prev, [w.id as string]: e.target.value }))}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function UsersManager({
  users,
  onRefresh,
}: {
  users: Array<Record<string, unknown>>;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<Record<string, unknown>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Record<string, unknown> | null>(null);

  const update = async (id: string, patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await adminAction("update_user", { userId: id, ...patch });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  const adjust = async (id: string, coins: number, usdt: number, reason: string) => {
    if (coins === 0 && usdt === 0) return;
    setBusy(true);
    try {
      await adminAction("adjust_balance", {
        userId: id,
        delta_coins: coins,
        delta_usdt: usdt,
        reason: reason || "manual adjustment",
      });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    setBusy(true);
    try {
      const data = (await adminAction("lookup_user", {
        query: query.trim() || null,
        limit: 25,
        offset: 0,
      })) as Array<Record<string, unknown>>;
      setResults(Array.isArray(data) ? data : []);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  const list = results ?? users;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className="bg-black/30 border border-white/10 rounded px-2 py-1 flex-1"
          placeholder="Search username / telegram id / referral code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button className="px-3 py-1 border border-white/20 rounded" onClick={search} disabled={busy}>
          Search
        </button>
        {results && (
          <button
            className="px-3 py-1 border border-white/20 rounded"
            onClick={() => {
              setResults(null);
              setQuery("");
            }}
          >
            Reset
          </button>
        )}
      </div>
      {error && <div className="rounded bg-red-900/40 border border-red-500/50 p-2 text-sm">{error}</div>}
      {list.map((u: Record<string, unknown>) => (
        <div key={u.id as string} className="rounded-lg border border-white/10 p-3 space-y-2">
          <div className="flex justify-between items-center">
            <div>
              <div className="font-medium">{String(u.username || u.telegram_id)}</div>
              <div className="text-xs text-white/60">Coins: {Number(u.coins)} · USDT: {String(u.usdt_balance)} · Trust: {Number(u.trust_score)} · Banned: {u.is_banned ? "yes" : "no"} · Admin: {u.is_admin ? "yes" : "no"}</div>
            </div>
            <div className="flex gap-2">
              <button className="px-2 py-1 border border-white/20 rounded text-xs" onClick={() => setInspect(u)}>Inspect</button>
              <button className="px-2 py-1 border border-red-500/50 rounded text-xs" onClick={() => update(u.id as string, { is_banned: !u.is_banned })}>{Boolean(u.is_banned) ? "Unban" : "Ban"}</button>
            </div>
          </div>
          <BalanceEditor disabled={busy} onSubmit={(coins, usdt, reason) => adjust(u.id as string, coins, usdt, reason)} />
        </div>
      ))}
      {list.length === 0 && <div className="text-sm text-white/50">No users found.</div>}
      {inspect && (
        <div className="fixed inset-0 z-50 bg-black/70 p-4 overflow-auto" onClick={() => setInspect(null)}>
          <div className="mx-auto max-w-lg rounded-lg border border-white/15 bg-[#0B0E14] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold">User inspector</h3>
              <button className="px-2 py-1 border border-white/20 rounded text-xs" onClick={() => setInspect(null)}>Close</button>
            </div>
            <pre className="text-xs whitespace-pre-wrap break-all text-white/70">{JSON.stringify(inspect, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function BalanceEditor({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (coins: number, usdt: number, reason: string) => void;
}) {
  const [coins, setCoins] = useState(0);
  const [usdt, setUsdt] = useState(0);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <input className="bg-black/30 border border-white/10 rounded px-2 py-1 w-24" type="number" placeholder="±coins" value={coins} onChange={(e) => setCoins(Number(e.target.value))} />
      <input className="bg-black/30 border border-white/10 rounded px-2 py-1 w-24" type="number" step="0.01" placeholder="±USDT" value={usdt} onChange={(e) => setUsdt(Number(e.target.value))} />
      <input className="bg-black/30 border border-white/10 rounded px-2 py-1 flex-1" placeholder="Reason (audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="px-2 py-1 border border-orange-500/50 rounded text-xs" disabled={disabled} onClick={() => onSubmit(coins, usdt, reason)}>
        Adjust balance
      </button>
    </div>
  );
}

function BroadcastManager() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let offset = 0;
      let sent = 0;
      let done = false;
      let guard = 0;
      while (!done && guard < 1000) {
        const res = (await adminAction("broadcast", { message, offset })) as {
          processed: number;
          sent: number;
          nextOffset: number;
          done: boolean;
        };
        sent += res.sent;
        offset = res.nextOffset;
        done = res.done;
        guard += 1;
      }
      setResult(`Delivery complete · ${sent} message(s) sent`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <textarea
        className="bg-black/30 border border-white/10 rounded px-3 py-2 w-full min-h-32"
        placeholder="Broadcast message to all non-banned users…"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <button className="px-4 py-2 rounded bg-orange-600 disabled:opacity-50" onClick={send} disabled={busy || !message.trim()}>
        {busy ? "Sending…" : "Send broadcast"}
      </button>
      {result && <div className="rounded border border-green-500/40 bg-green-900/20 p-2 text-sm">{result}</div>}
      {error && <div className="rounded border border-red-500/50 bg-red-900/40 p-2 text-sm">{error}</div>}
    </div>
  );
}
