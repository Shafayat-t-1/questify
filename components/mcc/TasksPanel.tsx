"use client";

import { useRef, useState } from "react";
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
  verification_type: string;
  verification_target: string;
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
  verification_type: "none",
  verification_target: "",
  is_active: true,
};

/** Phase 4A verification options (server rejects unknown types as misconfigured). */
const VERIFICATION_OPTIONS = [
  { value: "none", label: "None — time gate only" },
  { value: "telegram_join", label: "Telegram — joined chat (bot)" },
  { value: "telegram_boost", label: "Telegram — channel boost (bot)" },
  { value: "github_star", label: "GitHub — starred repo (OAuth)" },
  { value: "github_fork", label: "GitHub — forked repo (OAuth)" },
  { value: "account_link", label: "Linked account (manual providers)" },
];

function verificationTargetHint(type: string): string {
  if (type.startsWith("telegram_")) return "@channel or -100… chat id (bot must be admin)";
  if (type.startsWith("github_")) return "owner/repo (e.g. octocat/hello-world)";
  if (type === "account_link") return "Provider: x, youtube, tiktok, reddit…";
  return "Target";
}

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
    verification_type: task.verification_type?.trim() || "none",
    verification_target: task.verification_target ?? "",
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
  const formRef = useRef<HTMLDivElement>(null);

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
        // "none" clears the field (the RPC coalesces null → keeps the old value).
        verification_type: form.verification_type.trim() || "none",
        verification_target:
          form.verification_type === "none" ? null : form.verification_target.trim() || null,
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
    "rounded-lg border border-mcc-line bg-mcc-inset px-3 py-2 text-sm text-mcc-text placeholder:text-mcc-dim focus:border-mcc-gold/50 focus:outline-none";

  return (
    <div className="space-y-4">
      <div ref={formRef} className="rounded-xl border border-mcc-line bg-mcc-surface p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-mcc-text">
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-mcc-gold/30 bg-mcc-gold/10 text-mcc-gold-bright">
            {editing ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          </span>
          {editing ? "Edit task" : "Create task"}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input className={field} placeholder="Title" value={form.title} onChange={(e) => set("title", e.target.value)} />
          <input className={field} placeholder="Platform (telegram/x/youtube/tiktok…)" value={form.platform} onChange={(e) => set("platform", e.target.value)} />
          <input className={field} placeholder="Action URL" value={form.action_url} onChange={(e) => set("action_url", e.target.value)} />
          <input className={field} placeholder="Action label" value={form.action_label} onChange={(e) => set("action_label", e.target.value)} />
          <input className={cn(field, "sm:col-span-2 lg:col-span-3")} placeholder="Description (optional)" value={form.description} onChange={(e) => set("description", e.target.value)} />
          <input className={field} inputMode="numeric" placeholder="Reward coins" value={form.reward_coins} onChange={(e) => set("reward_coins", e.target.value)} />
          <input className={field} inputMode="decimal" placeholder="Reward USDT" value={form.reward_usdt} onChange={(e) => set("reward_usdt", e.target.value)} />
          <input className={field} inputMode="decimal" placeholder="Margin USDT (sponsor profit)" value={form.margin_usdt} onChange={(e) => set("margin_usdt", e.target.value)} />
          <input className={field} inputMode="numeric" placeholder="Duration seconds (anti-cheat)" value={form.duration_seconds} onChange={(e) => set("duration_seconds", e.target.value)} />
          <input className={field} inputMode="numeric" placeholder="Max completions (0 = unlimited)" value={form.max_completions} onChange={(e) => set("max_completions", e.target.value)} />
          <select
            className={field}
            value={form.verification_type}
            onChange={(e) => set("verification_type", e.target.value)}
          >
            {VERIFICATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-mcc-surface text-mcc-text">
                {opt.label}
              </option>
            ))}
          </select>
          {form.verification_type !== "none" && (
            <input
              className={field}
              placeholder={verificationTargetHint(form.verification_type)}
              value={form.verification_target}
              onChange={(e) => set("verification_target", e.target.value)}
            />
          )}
          <label className="flex items-center gap-2 text-xs text-mcc-muted">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
              className="accent-mcc-gold"
            />
            Active
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg bg-mcc-gold px-4 py-2 text-xs font-bold text-mcc-bg transition hover:bg-mcc-gold-bright active:scale-95 disabled:opacity-50"
          >
            {editing ? "Update task" : "Create task"}
          </button>
          {editing && (
            <button
              onClick={() => {
                setEditing(null);
                setForm(EMPTY);
              }}
              className="rounded-lg border border-mcc-line px-4 py-2 text-xs font-semibold text-mcc-muted transition hover:border-mcc-line-strong hover:text-mcc-text"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-mcc-line bg-mcc-surface">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="text-left">
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Task
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Reward
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Margin
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Completions
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Anti-cheat
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Status
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr
                key={t.id}
                className="border-b border-mcc-line/60 transition last:border-0 hover:bg-mcc-surface-2/70"
              >
                <td className="px-4 py-3">
                  <p className="max-w-[320px] truncate text-sm font-medium text-mcc-text">{t.title}</p>
                  <p className="mt-0.5 text-[11px] text-mcc-dim">
                    {t.platform}
                    {t.verification_type && t.verification_type !== "none"
                      ? ` · ${t.verification_type}`
                      : ""}
                  </p>
                </td>
                <td className="px-4 py-3 text-right text-xs tabular-nums text-mcc-text">
                  {formatCoins(t.reward_coins)} coins
                  <span className="block text-[11px] text-mcc-muted">
                    {formatUsdt(t.reward_usdt)} USDT
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-xs tabular-nums text-mcc-muted">
                  {formatUsdt(t.margin_usdt ?? 0)} USDT
                </td>
                <td className="px-4 py-3 text-center text-xs tabular-nums text-mcc-muted">
                  {t.completions ?? 0}
                  {t.max_completions ? `/${t.max_completions}` : ""}
                </td>
                <td className="px-4 py-3 text-center text-xs tabular-nums text-mcc-muted">
                  {t.duration_seconds ? `${t.duration_seconds}s` : "—"}
                </td>
                <td className="px-4 py-3">
                  {t.is_active ? (
                    <span className="inline-block rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                      Active
                    </span>
                  ) : (
                    <span className="inline-block rounded-full border border-mcc-gold/40 bg-mcc-gold/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-mcc-gold-bright">
                      Inactive
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      onClick={() => {
                        setEditing(t.id);
                        setForm(toForm(t));
                        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      className="rounded-lg border border-mcc-line-strong px-2.5 py-1 text-[11px] font-semibold text-mcc-muted transition hover:border-mcc-gold/50 hover:text-mcc-text"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void remove(t)}
                      className="flex items-center gap-1 rounded-lg border border-red-500/40 px-2.5 py-1 text-[11px] font-semibold text-red-300 transition hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-mcc-dim">
                  No tasks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
