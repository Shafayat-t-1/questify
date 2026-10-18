"use client";

import { Activity, CheckCircle2, Coins, Gauge, Megaphone, Users } from "lucide-react";
import { cn, formatUsdt } from "@/lib/utils";
import type { MccData, MccLedgerEntry, MccLiveData } from "./types";

function StatCard({
  label,
  value,
  Icon,
  tint,
  sub,
  delta,
}: {
  label: string;
  value: string;
  Icon: React.ElementType;
  tint: string;
  sub?: string;
  delta?: { label: string; positive: boolean };
}) {
  return (
    <div className="rounded-xl border border-mcc-line bg-mcc-surface p-4 transition hover:border-mcc-line-strong">
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "grid h-9 w-9 place-items-center rounded-lg border border-mcc-line",
            tint,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        {delta && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
              delta.positive
                ? "bg-emerald-400/10 text-emerald-300"
                : "bg-red-400/10 text-red-300",
            )}
          >
            {delta.label}
          </span>
        )}
      </div>
      <p className="mt-3 text-xl font-semibold tracking-tight tabular-nums text-mcc-text sm:text-2xl">
        {value}
      </p>
      <p className="mt-1 text-xs text-mcc-muted">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-mcc-dim">{sub}</p>}
    </div>
  );
}

function WalletLedger({ title, entries }: { title: string; entries: MccLedgerEntry[] }) {
  return (
    <div className="rounded-xl border border-mcc-line bg-mcc-surface">
      <p className="border-b border-mcc-line px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-mcc-dim">
        {title}
      </p>
      {entries.length === 0 && (
        <p className="px-4 py-3 text-[11px] text-mcc-dim">No entries yet.</p>
      )}
      <div className="divide-y divide-mcc-line/60">
        {entries.map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between gap-3 px-4 py-2.5 text-[11px]"
          >
            <span className="truncate text-mcc-muted">{e.type}</span>
            <span
              className={cn(
                "shrink-0 font-medium tabular-nums",
                e.amount_usdt < 0 ? "text-red-300" : "text-emerald-300",
              )}
            >
              {e.amount_usdt >= 0 ? "+" : ""}
              {formatUsdt(e.amount_usdt)} → {formatUsdt(e.balance_after)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function tickLabel(at: string | null): string {
  if (!at) return "waiting for first signal…";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleTimeString();
}

export function OverviewPanel({
  data,
  live,
  lastTickAt,
}: {
  data: MccData;
  live: MccLiveData | null;
  lastTickAt: string | null;
}) {
  const stats = live?.stats ?? data.stats;
  const owner = live?.wallets.owner ?? data.wallets?.owner.balance ?? 0;
  const marketing = live?.wallets.marketing ?? data.wallets?.marketing.balance ?? 0;

  const ticks = live?.ticks ?? {};
  const sources = ["owner_wallet", "marketing_wallet", "task_completed", "withdrawal"] as const;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Total users"
          value={String(stats.totalUsers)}
          Icon={Users}
          tint="border-mcc-teal/25 bg-mcc-teal/10 text-mcc-teal"
        />
        <StatCard
          label="Tasks completed"
          value={String(stats.totalTasksCompleted)}
          Icon={CheckCircle2}
          tint="border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
        />
        <StatCard
          label="Pending payouts"
          value={String(stats.pendingWithdrawals)}
          Icon={Gauge}
          tint="border-mcc-gold/25 bg-mcc-gold/10 text-mcc-gold-bright"
        />
        <StatCard
          label="Total paid out"
          value={`${formatUsdt(stats.totalPaidOut)} USDT`}
          Icon={Coins}
          tint="border-mcc-gold/25 bg-mcc-gold/10 text-mcc-gold-bright"
        />
        <StatCard
          label="Owner wallet"
          value={`${formatUsdt(owner)} USDT`}
          Icon={Coins}
          tint="border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
          sub="ledger-backed balance"
        />
        <StatCard
          label="Marketing wallet"
          value={`${formatUsdt(marketing)} USDT`}
          Icon={Megaphone}
          tint="border-mcc-teal/25 bg-mcc-teal/10 text-mcc-teal"
          sub="referral commissions source"
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-mcc-teal/30 bg-mcc-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-mcc-teal/20 bg-mcc-teal/[0.07] px-4 py-3">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-mcc-teal">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mcc-teal opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-mcc-teal" />
            </span>
            Live · Realtime heartbeat
          </p>
          <p className="text-[11px] tabular-nums text-mcc-dim">
            Last signal: {tickLabel(lastTickAt)}
          </p>
        </div>
        <div className="p-4">
          <p className="text-[11px] leading-relaxed text-mcc-muted">
            Numbers refetch on every heartbeat and when this window regains focus — the live channel
            carries only a source name, never amounts.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {sources.map((source) => (
              <div
                key={source}
                className="rounded-lg border border-mcc-line bg-mcc-inset px-3 py-2.5"
              >
                <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-mcc-dim">
                  {source.replace(/_/g, " ")}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] tabular-nums text-mcc-text">
                  <Activity className="h-3 w-3 shrink-0 text-mcc-teal" />
                  {ticks[source] ? tickLabel(ticks[source]) : "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <WalletLedger title="Owner wallet · recent" entries={data.wallets?.owner.entries ?? []} />
        <WalletLedger title="Marketing wallet · recent" entries={data.wallets?.marketing.entries ?? []} />
      </div>
    </div>
  );
}
