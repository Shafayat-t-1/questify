"use client";

import { useState } from "react";
import { Megaphone, ScrollText, Send, SlidersHorizontal } from "lucide-react";
import { adminFetch } from "@/lib/admin-client";
import { cn } from "@/lib/utils";
import type { MccAction, MccSetting } from "./types";

type Notify = (kind: "success" | "error", title: string, message: string) => void;

interface SettingField {
  key: string;
  label: string;
  kind: "number" | "numbers" | "text";
  hint?: string;
}

const SETTING_FIELDS: SettingField[] = [
  { key: "owner_wallet_split_pct", label: "Owner wallet split (fraction)", kind: "number", hint: "must sum to 1 with marketing" },
  { key: "marketing_wallet_split_pct", label: "Marketing wallet split (fraction)", kind: "number" },
  { key: "referral_tier1_commission_pct", label: "Tier-1 referral commission (fraction)", kind: "number", hint: "of task margin" },
  { key: "referral_tier2_commission_pct", label: "Tier-2 referral commission (fraction)", kind: "number", hint: "of task margin" },
  { key: "referral_instant_bonus_coins", label: "Instant referral bonus (coins)", kind: "number" },
  { key: "referral_instant_bonus_usdt", label: "Instant referral bonus (USDT)", kind: "number" },
  { key: "referral_bonus_min_tasks", label: "Min tasks before instant bonus", kind: "number" },
  { key: "referral_commission_pct", label: "Referral commission (legacy, unused)", kind: "number", hint: "0.1 = 10%" },
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

const field =
  "rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-neon-orange/40 focus:outline-none";

export function SettingsPanel({
  settings,
  notify,
}: {
  settings: MccSetting[];
  notify: Notify;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const save = async (f: SettingField) => {
    const raw = edits[f.key];
    if (raw === undefined) return;
    const current = settings.find((s) => s.key === f.key)?.value;

    let value: unknown;
    if (f.kind === "number") {
      value = Number(raw);
      if (!Number.isFinite(value)) return notify("error", "Invalid value", `${f.label} must be a number.`);
    } else if (f.kind === "numbers") {
      value = raw
        .split(",")
        .map((p) => Number(p.trim()))
        .filter((n) => Number.isFinite(n));
      if ((value as number[]).length === 0) return notify("error", "Invalid value", "Enter comma-separated numbers.");
    } else {
      value = raw.trim();
      if (!value) return notify("error", "Invalid value", "Value cannot be empty.");
    }
    if (JSON.stringify(value) === JSON.stringify(current)) return;

    setSavingKey(f.key);
    const res = await adminFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "update_settings", key: f.key, value }),
    });
    setSavingKey(null);
    if (!res.ok) return notify("error", "Save failed", res.error ?? "failed");
    notify("success", "Setting saved", f.label);
    setEdits((prev) => {
      const next = { ...prev };
      delete next[f.key];
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <SlidersHorizontal className="h-4 w-4 text-neon-orange" /> Business rules
        </p>
        <p className="mt-1 text-[11px] text-white/45">
          Every number the platform uses (rewards, limits, commission, coin rate, fees) lives in
          <span className="font-mono text-white/60"> platform_settings</span>, read server-side and
          authoritative. Changes take effect on the next request — no redeploy.
        </p>
      </div>
      {SETTING_FIELDS.map((f) => {
        const current = settings.find((s) => s.key === f.key)?.value;
        const display =
          edits[f.key] ??
          (Array.isArray(current) ? current.join(", ") : current === undefined ? "" : String(current));
        return (
          <div key={f.key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <label className="text-[12px] font-medium text-white/75">{f.label}</label>
            {f.hint && <span className="ml-1 text-[10px] text-white/35">({f.hint})</span>}
            <div className="mt-2 flex gap-2">
              <input
                value={display}
                onChange={(e) => setEdits((prev) => ({ ...prev, [f.key]: e.target.value }))}
                inputMode={f.kind === "text" ? "text" : "decimal"}
                className={cn(field, "flex-1")}
              />
              <button
                onClick={() => void save(f)}
                disabled={savingKey === f.key}
                className="rounded-xl bg-gradient-to-br from-neon-orange to-amber-500 px-4 text-xs font-bold text-black transition active:scale-95 disabled:opacity-50"
              >
                {savingKey === f.key ? "…" : "Save"}
              </button>
            </div>
            {current === undefined && (
              <p className="mt-1 text-[10px] text-amber-300/70">Not in DB yet — saving will create it.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BroadcastPanel({ notify }: { notify: Notify }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const send = async () => {
    const text = message.trim();
    if (!text) return notify("error", "Message required", "Type a broadcast first.");
    setBusy(true);
    let offset = 0;
    let sent = 0;
    let done = false;
    let guard = 0;
    while (!done && guard < 2000) {
      guard += 1;
      const res = await adminFetch<{ processed: number; sent: number; nextOffset: number; done: boolean }>(
        "/api/admin",
        { method: "POST", body: JSON.stringify({ action: "broadcast", message: text, offset }) },
      );
      if (!res.ok || !res.data) {
        setBusy(false);
        setProgress(null);
        return notify("error", "Broadcast failed", res.error ?? "failed");
      }
      sent += res.data.sent;
      offset = res.data.nextOffset;
      done = res.data.done;
      setProgress(`Sent to ${sent} users…`);
    }
    setBusy(false);
    setProgress(null);
    setMessage("");
    notify("success", "Broadcast complete", `${sent} messages delivered.`);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
        <Megaphone className="h-4 w-4 text-neon-orange" /> Broadcast to all users
      </p>
      <p className="mt-1 text-[11px] text-white/45">
        Paginated at 150 users per call, non-banned recipients only. Telegram rate limits apply.
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={6}
        placeholder="Write an announcement…"
        className={cn(field, "mt-3 w-full resize-none")}
      />
      <button
        onClick={() => void send()}
        disabled={busy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-neon-orange to-amber-500 py-2.5 text-sm font-bold text-black transition active:scale-[0.99] disabled:opacity-50"
      >
        <Send className="h-4 w-4" /> {busy ? progress ?? "Sending…" : "Send broadcast"}
      </button>
    </div>
  );
}

export function AuditPanel({ actions }: { actions: MccAction[] }) {
  return (
    <div className="space-y-2">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <ScrollText className="h-4 w-4 text-neon-orange" /> Admin audit log
        </p>
        <p className="mt-1 text-[11px] text-white/45">
          Every privileged write appends a row here (money movements additionally write a ledger
          entry in the same transaction).
        </p>
      </div>
      {actions.map((a) => (
        <div key={a.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-white">{a.action}</p>
            <span className="text-[10px] text-white/35">{new Date(a.created_at).toLocaleString()}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-white/45">
            {a.target_type ?? "—"} · {a.target_id ?? "—"}
          </p>
          {a.details ? (
            <pre className="mt-1.5 overflow-x-auto rounded-lg bg-black/25 p-2 text-[10px] text-white/50">
              {JSON.stringify(a.details, null, 2)}
            </pre>
          ) : null}
        </div>
      ))}
      {actions.length === 0 && (
        <p className="py-8 text-center text-xs text-white/40">No admin actions recorded yet.</p>
      )}
    </div>
  );
}
