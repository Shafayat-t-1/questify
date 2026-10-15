"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { adminFetch } from "@/lib/admin-client";
import { cn, formatCoins, formatUsdt } from "@/lib/utils";
import type { MccTask } from "./types";

interface TaskForm {
  title: string;
  description: string;
  platform: string;
  action_label: string;
  action_url: string;
  reward_coins: string;
  reward_usdt: string;
  margin_usdt: string;
  duration_seconds: string;
  max_completions: string;
  is_active: boolean;
}

const EMPTY: TaskForm = {
  title: "",
  description: "",
  platform: "telegram",
  action_label: "Open",
  action_url: "",
  reward_coins: "100",
  reward_usdt: "0.01",
  margin_usdt: "0",
  duration_seconds: "0",
  max_completions: "0",
  is_active: true,
};

function toForm(task: MccTask): TaskForm {
  return {
    title: task.title ?? "",
    description: "",
    platform: task.platform ?? "",
    action_label: task.action_label ?? "",
    action_url: task.action_url ?? "",
    reward_coins: String(task.reward_coins ?? 0),
    reward_usdt: String(task.reward_usdt ?? 0),
    margin_usdt: String(task.margin_usdt ?? 0),
    duration_seconds: String(task.duration_seconds ?? 0),
    max_completions: String(task.max_completions ?? 0),
    is_active: Boolean(task.is_active),
  };
}

export function TasksPanel({
  tasks,
  onReload,
  notify,
}: {
  tasks: MccTask[];
  onReload: () => void;
  notify: (kind: "success" | "error", title: string, message: string) => void;
}) {
  const [form, setForm] = useState<TaskForm>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof TaskForm>(key: K, value: TaskForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.title.trim()) return notify("error", "Title required", "Give the task a title.");
    setBusy(true);
    const res = await adminFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({
        action: "upsert_task",
        p_task_id: editing,
        title: form.title.trim(),
        description: form.description.trim() || null,
        platform: form.platform.trim(),
        action_label: form.action_label.trim(),
        action_url: form.action_url.trim() || null,
        reward_coins: Number(form.reward_coins) || 0,
        reward_usdt: Number(form.reward_usdt) || 0,
        margin_usdt: Number(form.margin_usdt) || 0,
        duration_seconds: Number(form.duration_seconds) || 0,
        max_completions: Number(form.max_completions) || 0,
        is_active: form.is_active,
      }),
    });
    setBusy(false);
    if (!res.ok) return notify("error", "Save failed", res.error ?? "failed");
    notify("success", editing ? "Task updated" : "Task created", form.title.trim());
    setForm(EMPTY);
    setEditing(null);
    onReload();
  };

  const remove = async (task: MccTask) => {
    if (!window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
    setBusy(true);
    const res = await adminFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "delete_task", taskId: task.id }),
    });
    setBusy(false);
    if (!res.ok) return notify("error", "Delete failed", res.error ?? "failed");
    notify("success", "Task deleted", task.title);
    onReload();
  };

  const field =
    "rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-neon-orange/40 focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
          {editing ? <Pencil className="h-4 w-4 text-neon-orange" /> : <Plus className="h-4 w-4 text-neon-orange" />}
          {editing ? "Edit task" : "Create task"}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input className={field} placeholder="Title" value={form.title} onChange={(e) => set("title", e.target.value)} />
          <input className={field} placeholder="Platform (telegram/x/youtube/tiktok…)" value={form.platform} onChange={(e) => set("platform", e.target.value)} />
          <input className={field} placeholder="Action URL" value={form.action_url} onChange={(e) => set("action_url", e.target.value)} />
          <input className={field} placeholder="Action label" value={form.action_label} onChange={(e) => set("action_label", e.target.value)} />
          <input className={cn(field, "sm:col-span-2")} placeholder="Description (optional)" value={form.description} onChange={(e) => set("description", e.target.value)} />
          <input className={field} inputMode="numeric" placeholder="Reward coins" value={form.reward_coins} onChange={(e) => set("reward_coins", e.target.value)} />
          <input className={field} inputMode="decimal" placeholder="Reward USDT" value={form.reward_usdt} onChange={(e) => set("reward_usdt", e.target.value)} />
          <input className={field} inputMode="decimal" placeholder="Margin USDT (sponsor profit)" value={form.margin_usdt} onChange={(e) => set("margin_usdt", e.target.value)} />
          <input className={field} inputMode="numeric" placeholder="Duration seconds (anti-cheat)" value={form.duration_seconds} onChange={(e) => set("duration_seconds", e.target.value)} />
          <input className={field} inputMode="numeric" placeholder="Max completions (0 = unlimited)" value={form.max_completions} onChange={(e) => set("max_completions", e.target.value)} />
          <label className="flex items-center gap-2 text-xs text-white/60">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
            Active
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-xl bg-gradient-to-br from-neon-orange to-amber-500 px-4 py-2 text-xs font-bold text-black transition active:scale-95 disabled:opacity-50"
          >
            {editing ? "Update task" : "Create task"}
          </button>
          {editing && (
            <button
              onClick={() => {
                setEditing(null);
                setForm(EMPTY);
              }}
              className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-white/60"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {tasks.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {t.title}
                <span className="ml-2 text-[11px] font-normal text-white/40">{t.platform}</span>
                {!t.is_active && (
                  <span className="ml-2 text-[10px] font-bold uppercase text-amber-300">inactive</span>
                )}
              </p>
              <p className="text-[11px] text-white/45">
                {formatCoins(t.reward_coins)} coins · {formatUsdt(t.reward_usdt)} USDT · margin{" "}
                {formatUsdt(t.margin_usdt ?? 0)} · {t.completions ?? 0}
                {t.max_completions ? `/${t.max_completions}` : ""} done
                {t.duration_seconds ? ` · ${t.duration_seconds}s` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => {
                  setEditing(t.id);
                  setForm(toForm(t));
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-white/70"
              >
                Edit
              </button>
              <button
                onClick={() => void remove(t)}
                className="flex items-center gap-1 rounded-lg border border-red-500/40 px-2.5 py-1 text-[11px] text-red-300"
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </div>
          </div>
        ))}
        {tasks.length === 0 && (
          <p className="py-8 text-center text-xs text-white/40">No tasks yet.</p>
        )}
      </div>
    </div>
  );
}
