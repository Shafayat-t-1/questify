"use client";

import { useEffect, useState } from "react";
import { getSessionToken } from "@/lib/session-client";
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

interface AdminData {
  stats: AdminStats;
  users: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  withdrawals: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const token = getSessionToken();
  const [tab, setTab] = useState<"tasks" | "withdrawals" | "users" | "stats">("stats");

  useEffect(() => {
    if (!token) return;
    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "failed");
        if (isMounted) {
          setData(json.data);
          setError(null);
        }
      } catch (e: unknown) {
        if (isMounted) {
          setError(e instanceof Error ? e.message : "failed");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    fetchData();
    return () => {
      isMounted = false;
    };
  }, [token]);

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 text-white">
        <div className="rounded-lg border border-white/10 p-6">Admin requires Supabase configuration.</div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 text-white">
        <div className="rounded-lg border border-white/10 p-6">Please authenticate via Telegram Mini App.</div>
      </div>
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
            {["stats", "tasks", "withdrawals", "users"].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t as "tasks" | "withdrawals" | "users" | "stats")}
                className={`px-3 py-1 rounded border ${tab === t ? "border-orange-500" : "border-white/20"}`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          {tab === "stats" && (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total Users" value={data.stats.totalUsers} />
              <StatCard label="Tasks Completed" value={data.stats.totalTasksCompleted} />
              <StatCard label="Pending Withdrawals" value={data.stats.pendingWithdrawals} />
              <StatCard label="Total Paid Out" value={`${formatUsdt(data.stats.totalPaidOut)} USDT`} />
              <StatCard label="Total Active Users" value={data.stats.totalActiveUsers} />
              <StatCard label="Platform Liquidity" value={`${formatUsdt(data.stats.platformLiquidity)} USDT`} />
            </div>
          )}
          {tab === "tasks" && <TasksManager tasks={data.tasks} onRefresh={() => {}} token={token} />}
          {tab === "withdrawals" && <WithdrawalsManager withdrawals={data.withdrawals} onRefresh={() => {}} token={token} />}
          {tab === "users" && <UsersManager users={data.users} onRefresh={() => {}} token={token} />}
        </div>
      )}
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

function TasksManager({ tasks, onRefresh, token }: { tasks: Array<Record<string, unknown>>; onRefresh: () => void; token: string }) {
  const [form, setForm] = useState<Record<string, unknown>>({ is_active: true });
  const [editing, setEditing] = useState<string | null>(null);

  const submit = async () => {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "upsert_task", p_task_id: editing || null, ...form }),
    });
    setEditing(null);
    setForm({ is_active: true });
    onRefresh();
  };

  const del = async (id: string) => {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "delete_task", taskId: id }),
    });
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
        </div>
        <button className="px-3 py-1 rounded bg-orange-600" onClick={submit}>{editing ? "Update" : "Add"}</button>
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

function WithdrawalsManager({ withdrawals, onRefresh, token }: { withdrawals: Array<Record<string, unknown>>; onRefresh: () => void; token: string }) {
  const update = async (id: string, status: string) => {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "update_withdrawal", withdrawalId: id, status }),
    });
    onRefresh();
  };

  return (
    <div className="space-y-2">
      {withdrawals.map((w: Record<string, unknown>) => (
        <div key={w.id as string} className="rounded-lg border border-white/10 p-3 flex justify-between items-center">
          <div>
            <div className="font-medium">{formatUsdt(Number(w.amount_usdt))} USDT via {String(w.network)}</div>
            <div className="text-xs text-white/60">User: {String(((w.profiles as Record<string, unknown>)?.username) || w.user_id)} · Status: {String(w.status)}</div>
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
      ))}
    </div>
  );
}

function UsersManager({ users, onRefresh, token }: { users: Array<Record<string, unknown>>; onRefresh: () => void; token: string }) {
  const update = async (id: string, patch: Record<string, unknown>) => {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "update_user", userId: id, ...patch }),
    });
    onRefresh();
  };

  return (
    <div className="space-y-2">
      {users.map((u: Record<string, unknown>) => (
        <div key={u.id as string} className="rounded-lg border border-white/10 p-3 flex justify-between items-center">
          <div>
            <div className="font-medium">{String(u.username || u.telegram_id)}</div>
            <div className="text-xs text-white/60">Coins: {Number(u.coins)} · USDT: {String(u.usdt_balance)} · Trust: {Number(u.trust_score)} · Banned: {u.is_banned ? "yes" : "no"} · Admin: {u.is_admin ? "yes" : "no"}</div>
          </div>
          <div className="flex gap-2">
            <button className="px-2 py-1 border border-red-500/50 rounded text-xs" onClick={() => update(u.id as string, { is_banned: !u.is_banned })}>{Boolean(u.is_banned) ? "Unban" : "Ban"}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
