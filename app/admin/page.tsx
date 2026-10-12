"use client";

import { useEffect, useMemo, useState } from "react";
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
  users: any[];
  tasks: any[];
  withdrawals: any[];
  actions: any[];
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const token = getSessionToken();
  const [tab, setTab] = useState<"tasks" | "withdrawals" | "users" | "stats">("stats");

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "failed");
      setData(json.data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchData();
    else setLoading(false);
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
                onClick={() => setTab(t as any)}
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
          {tab === "tasks" && <TasksManager tasks={data.tasks} onRefresh={fetchData} token={token} />}
          {tab === "withdrawals" && <WithdrawalsManager withdrawals={data.withdrawals} onRefresh={fetchData} token={token} />}
          {tab === "users" && <UsersManager users={data.users} onRefresh={fetchData} token={token} />}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border border-white/10 p-4">
      <div className="text-xs text-white/60">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function TasksManager({ tasks, onRefresh, token }: any) {
  const [form, setForm] = useState<any>({ is_active: true });
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
        <input className="bg-black/30 border border-white/10 rounded px-2 py-1 w-full" placeholder="Title" value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input className="bg-black/30 border border-white/10 rounded px-2 py-1 w-full" placeholder="Platform (telegram/x/youtube/tiktok/github/reddit/discord)" value={form.platform || ""} onChange={(e) => setForm({ ...form, platform: e.target.value })} />
        <input className="bg-black/30 border border-white/10 rounded px-2 py-1 w-full" placeholder="Action URL" value={form.action_url || ""} onChange={(e) => setForm({ ...form, action_url: e.target.value })} />
        <input className="bg-black/30 border border-white/10 rounded px-2 py-1 w-full" placeholder="Action Label" value={form.action_label || ""} onChange={(e) => setForm({ ...form, action_label: e.target.value })} />
        <div className="flex gap-2">
          <input className="bg-black/30 border border-white/10 rounded px-2 py-1 flex-1" type="number" placeholder="Coins" value={form.reward_coins || 0} onChange={(e) => setForm({ ...form, reward_coins: Number(e.target.value) })} />
          <input className="bg-black/30 border border-white/10 rounded px-2 py-1 flex-1" type="number" step="0.01" placeholder="USDT" value={form.reward_usdt || 0} onChange={(e) => setForm({ ...form, reward_usdt: Number(e.target.value) })} />
        </div>
        <button className="px-3 py-1 rounded bg-orange-600" onClick={submit}>{editing ? "Update" : "Add"}</button>
      </div>
      <div className="space-y-2">
        {tasks.map((t: any) => (
          <div key={t.id} className="rounded-lg border border-white/10 p-3 flex justify-between items-center">
            <div>
              <div className="font-medium">{t.title} ({t.platform})</div>
              <div className="text-xs text-white/60">{t.reward_coins} coins / {formatUsdt(t.reward_usdt)} USDT · {t.is_active ? "active" : "inactive"}</div>
            </div>
            <div className="flex gap-2">
              <button className="px-2 py-1 border border-white/20 rounded text-xs" onClick={() => { setEditing(t.id); setForm({ ...t }); }}>Edit</button>
              <button className="px-2 py-1 border border-red-500/50 rounded text-xs" onClick={() => del(t.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WithdrawalsManager({ withdrawals, onRefresh, token }: any) {
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
      {withdrawals.map((w: any) => (
        <div key={w.id} className="rounded-lg border border-white/10 p-3 flex justify-between items-center">
          <div>
            <div className="font-medium">{formatUsdt(w.amount_usdt)} USDT via {w.network}</div>
            <div className="text-xs text-white/60">User: {w.profiles?.username || w.user_id} · Status: {w.status}</div>
            <div className="text-xs text-white/40 truncate">{w.address}</div>
          </div>
          <div className="flex gap-2">
            {w.status === "pending" && (
              <>
                <button className="px-2 py-1 border border-green-500/50 rounded text-xs" onClick={() => update(w.id, "paid")}>Approve</button>
                <button className="px-2 py-1 border border-red-500/50 rounded text-xs" onClick={() => update(w.id, "rejected")}>Reject</button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function UsersManager({ users, onRefresh, token }: any) {
  const update = async (id: string, patch: any) => {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "update_user", userId: id, ...patch }),
    });
    onRefresh();
  };

  return (
    <div className="space-y-2">
      {users.map((u: any) => (
        <div key={u.id} className="rounded-lg border border-white/10 p-3 flex justify-between items-center">
          <div>
            <div className="font-medium">{u.username || u.telegram_id}</div>
            <div className="text-xs text-white/60">Coins: {u.coins} · USDT: {u.usdt_balance} · Trust: {u.trust_score} · Banned: {u.is_banned ? "yes" : "no"} · Admin: {u.is_admin ? "yes" : "no"}</div>
          </div>
          <div className="flex gap-2">
            <button className="px-2 py-1 border border-red-500/50 rounded text-xs" onClick={() => update(u.id, { is_banned: !u.is_banned })}>{u.is_banned ? "Unban" : "Ban"}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
