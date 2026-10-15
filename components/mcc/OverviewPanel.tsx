"use client";

import { Activity, CheckCircle2, Coins, Gauge, Megaphone, Radio, Users } from "lucide-react";
import { cn, formatUsdt } from "@/lib/utils";
import type { MccData, MccLedgerEntry, MccLiveData } from "./types";

function StatCard({
  label,
  value,
  Icon,
  tint,
  sub,
}: {
  label: string;
  value: string;
  Icon: React.ElementType;
  tint: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
      <Icon className={cn("h-4 w-4", tint)} />
      <p className="mt-2 text-xl font-bold tracking-tight text-white">{value}</p>
      <p className="text-[11px] text-white/45">{label}</p>
      {sub && <p className="mt-0.5 text-[10px] text-white/30">{sub}</p>}
    </div>
  );
}

function WalletLedger({ title, entries }: { title: string; entries: MccLedgerEntry[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[11px] font-medium text-white/45">{title}</p>
      {entries.length === 0 && <p className="mt-1 text-[11px] text-white/30">No entries yet.</p>}
      <div className="mt-2 space-y-1">
        {entries.map((e) => (
          <div key={e.id} className="flex items-center justify-between text-[11px]">
            <span className="text-white/50">{e.type}</span>
            <span className={e.amount_usdt < 0 ? "text-red-300" : "text-emerald-300"}>
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Total users" value={String(stats.totalUsers)} Icon={Users} tint="text-neon-cyan" />
        <StatCard
          label="Tasks completed"
          value={String(stats.totalTasksCompleted)}
          Icon={CheckCircle2}
          tint="text-emerald-300"
        />
        <StatCard
          label="Pending payouts"
          value={String(stats.pendingWithdrawals)}
          Icon={Gauge}
          tint="text-amber-300"
        />
        <StatCard
          label="Total paid out"
          value={`${formatUsdt(stats.totalPaidOut)} USDT`}
          Icon={Coins}
          tint="text-neon-orange"
        />
        <StatCard
          label="Owner wallet"
          value={`${formatUsdt(owner)} USDT`}
          Icon={Coins}
          tint="text-emerald-300"
          sub="ledger-backed balance"
        />
        <StatCard
          label="Marketing wallet"
          value={`${formatUsdt(marketing)} USDT`}
          Icon={Megaphone}
          tint="text-neon-cyan"
          sub="referral commissions source"
        />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
          <Radio className="h-3.5 w-3.5 text-emerald-300" /> Realtime heartbeat
        </p>
        <p className="mt-1 text-[11px] text-white/40">
          Last signal: {tickLabel(lastTickAt)}. Numbers refetch on every heartbeat and when this
          window regains focus — the live channel carries only a source name, never amounts.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {sources.map((source) => (
            <div key={source} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-white/35">
                {source.replace(/_/g, " ")}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/60">
                <Activity className="h-3 w-3 text-neon-orange" />
                {ticks[source] ? tickLabel(ticks[source]) : "—"}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <WalletLedger title="Owner wallet · recent" entries={data.wallets?.owner.entries ?? []} />
        <WalletLedger title="Marketing wallet · recent" entries={data.wallets?.marketing.entries ?? []} />
      </div>
    </div>
  );
}
