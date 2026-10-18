"use client";

import { useState } from "react";
import type { ComponentType } from "react";
import {
  CalendarClock,
  Coins,
  Megaphone,
  Percent,
  ScrollText,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Trophy,
} from "lucide-react";
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

interface SettingSection {
  key: string;
  title: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
  fields: SettingField[];
}

const SETTING_SECTIONS: SettingSection[] = [
  {
    key: "wallet-split",
    title: "Wallet split",
    description: "How revenue and the coin economy are divided between the two platform wallets.",
    Icon: Coins,
    fields: [
      { key: "owner_wallet_split_pct", label: "Owner wallet split (fraction)", kind: "number", hint: "must sum to 1 with marketing" },
      { key: "marketing_wallet_split_pct", label: "Marketing wallet split (fraction)", kind: "number" },
      { key: "coin_to_usdt_rate", label: "Coin→USDT rate", kind: "number" },
    ],
  },
  {
    key: "referral-commission",
    title: "Referral commission",
    description: "Everything an inviter earns: cut of task margin, instant bonuses and signup rewards.",
    Icon: Percent,
    fields: [
      { key: "referral_tier1_commission_pct", label: "Tier-1 referral commission (fraction)", kind: "number", hint: "of task margin" },
      { key: "referral_tier2_commission_pct", label: "Tier-2 referral commission (fraction)", kind: "number", hint: "of task margin" },
      { key: "referral_instant_bonus_coins", label: "Instant referral bonus (coins)", kind: "number" },
      { key: "referral_instant_bonus_usdt", label: "Instant referral bonus (USDT)", kind: "number" },
      { key: "referral_bonus_min_tasks", label: "Min tasks before instant bonus", kind: "number" },
      { key: "referral_commission_pct", label: "Referral commission (legacy, unused)", kind: "number", hint: "0.1 = 10%" },
      { key: "referral_signup_reward_coins", label: "Referral signup reward (coins)", kind: "number" },
      { key: "referral_signup_reward_usdt", label: "Referral signup reward (USDT)", kind: "number" },
    ],
  },
  {
    key: "trust-withdrawal",
    title: "Trust & withdrawal limits",
    description: "Trust scoring, level curve and every gate a user must pass to cash out.",
    Icon: ShieldCheck,
    fields: [
      { key: "trust_score_task_delta", label: "Trust gain per task", kind: "number" },
      { key: "trust_score_checkin_delta", label: "Trust gain per check-in", kind: "number" },
      { key: "trust_score_cap", label: "Trust score cap", kind: "number" },
      { key: "trust_threshold_for_withdrawal", label: "Min trust to withdraw", kind: "number" },
      { key: "min_withdrawal_usdt", label: "Minimum withdrawal (USDT)", kind: "number" },
      { key: "withdrawal_fee_bep20", label: "BEP-20 withdrawal fee (USDT)", kind: "number" },
      { key: "withdrawal_fee_ton", label: "TON withdrawal fee (USDT)", kind: "number" },
      { key: "level_coins_per_level", label: "Coins per level", kind: "number" },
    ],
  },
  {
    key: "checkin-schedule",
    title: "Check-in schedule",
    description: "Seven-day reward and multiplier schedule, comma-separated, day 1 first.",
    Icon: CalendarClock,
    fields: [
      { key: "checkin_reward_schedule", label: "Check-in rewards (7, comma-separated)", kind: "numbers" },
      { key: "checkin_multiplier_schedule", label: "Check-in multipliers (7, comma-separated)", kind: "numbers" },
    ],
  },
  {
    key: "leaderboard-copy",
    title: "Leaderboard copy",
    description: "Season wording shown to users on the leaderboard screen.",
    Icon: Trophy,
    fields: [
      { key: "leaderboard_season_label", label: "Leaderboard season label", kind: "text" },
      { key: "leaderboard_reset_label", label: "Leaderboard reset label", kind: "text" },
      { key: "leaderboard_reward_note", label: "Leaderboard reward note", kind: "text" },
    ],
  },
];

const field =
  "rounded-lg border border-mcc-line bg-mcc-inset px-3 py-2 text-sm text-mcc-text placeholder:text-mcc-dim focus:border-mcc-gold/50 focus:outline-none";

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
    <div className="space-y-4">
      <div className="rounded-xl border border-mcc-line bg-mcc-surface p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-mcc-text">
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-mcc-gold/30 bg-mcc-gold/10 text-mcc-gold-bright">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          Business rules
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-mcc-muted">
          Every number the platform uses (rewards, limits, commission, coin rate, fees) lives in
          <span className="font-mono text-mcc-text"> platform_settings</span>, read server-side and
          authoritative. Changes take effect on the next request — no redeploy.
        </p>
      </div>

      {SETTING_SECTIONS.map((section) => (
        <section key={section.key} className="overflow-hidden rounded-xl border border-mcc-line bg-mcc-surface">
          <div className="flex items-start gap-3 border-b border-mcc-line px-4 py-3.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-mcc-teal/30 bg-mcc-teal/10 text-mcc-teal">
              <section.Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-mcc-text">{section.title}</h2>
              <p className="mt-0.5 text-[11px] leading-relaxed text-mcc-dim">{section.description}</p>
            </div>
            <span className="ml-auto shrink-0 rounded-full border border-mcc-line bg-mcc-inset px-2 py-0.5 text-[10px] font-bold tabular-nums text-mcc-dim">
              {section.fields.length}
            </span>
          </div>
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            {section.fields.map((f) => {
              const current = settings.find((s) => s.key === f.key)?.value;
              const display =
                edits[f.key] ??
                (Array.isArray(current) ? current.join(", ") : current === undefined ? "" : String(current));
              return (
                <div key={f.key} className="rounded-lg border border-mcc-line/70 bg-mcc-inset/60 p-3">
                  <label className="block text-[12px] font-medium text-mcc-text">{f.label}</label>
                  {f.hint && (
                    <span className="mt-0.5 block text-[10px] text-mcc-dim">({f.hint})</span>
                  )}
                  <div className="mt-2 flex gap-2">
                    <input
                      value={display}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      inputMode={f.kind === "text" ? "text" : "decimal"}
                      className={cn(field, "min-w-0 flex-1")}
                    />
                    <button
                      onClick={() => void save(f)}
                      disabled={savingKey === f.key}
                      className="shrink-0 rounded-lg bg-mcc-gold px-4 text-xs font-bold text-mcc-bg transition hover:bg-mcc-gold-bright active:scale-95 disabled:opacity-50"
                    >
                      {savingKey === f.key ? "…" : "Save"}
                    </button>
                  </div>
                  {current === undefined && (
                    <p className="mt-1 text-[10px] text-mcc-gold/80">
                      Not in DB yet — saving will create it.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
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
    <div className="max-w-3xl rounded-xl border border-mcc-line bg-mcc-surface p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-mcc-text">
        <span className="grid h-7 w-7 place-items-center rounded-lg border border-mcc-gold/30 bg-mcc-gold/10 text-mcc-gold-bright">
          <Megaphone className="h-4 w-4" />
        </span>
        Broadcast to all users
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-mcc-muted">
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
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-mcc-gold py-2.5 text-sm font-bold text-mcc-bg transition hover:bg-mcc-gold-bright active:scale-[0.99] disabled:opacity-50"
      >
        <Send className="h-4 w-4" /> {busy ? progress ?? "Sending…" : "Send broadcast"}
      </button>
    </div>
  );
}

export function AuditPanel({ actions }: { actions: MccAction[] }) {
  return (
    <div className="rounded-xl border border-mcc-line bg-mcc-surface">
      <div className="border-b border-mcc-line p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-mcc-text">
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-mcc-gold/30 bg-mcc-gold/10 text-mcc-gold-bright">
            <ScrollText className="h-4 w-4" />
          </span>
          Admin audit log
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-mcc-muted">
          Every privileged write appends a row here (money movements additionally write a ledger
          entry in the same transaction).
        </p>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="text-left">
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Action
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Target
              </th>
              <th className="sticky top-0 z-10 border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Details
              </th>
              <th className="sticky top-0 z-10 whitespace-nowrap border-b border-mcc-line bg-mcc-surface-2 px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-mcc-dim">
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr
                key={a.id}
                className="border-b border-mcc-line/60 align-top transition last:border-0 hover:bg-mcc-surface-2/70"
              >
                <td className="px-4 py-3 text-xs font-semibold text-mcc-gold-bright">{a.action}</td>
                <td className="px-4 py-3 text-[11px] tabular-nums text-mcc-muted">
                  {a.target_type ?? "—"}
                  {a.target_id ? ` · ${a.target_id}` : ""}
                </td>
                <td className="px-4 py-3">
                  {a.details ? (
                    <pre className="max-w-[420px] whitespace-pre-wrap break-all rounded-lg bg-mcc-inset p-2 font-mono text-[10px] leading-relaxed text-mcc-muted">
                      {JSON.stringify(a.details, null, 2)}
                    </pre>
                  ) : (
                    <span className="text-[11px] text-mcc-dim">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-[11px] tabular-nums text-mcc-dim">
                  {new Date(a.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {actions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-xs text-mcc-dim">
                  No admin actions recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
