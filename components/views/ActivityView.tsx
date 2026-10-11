"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownToLine,
  CalendarCheck,
  Coins,
  Gift,
  Users,
} from "lucide-react";
import { useQuestify } from "@/providers/QuestifyProvider";
import { cn, formatCoins, formatUsdt, timeAgo } from "@/lib/utils";
import type { ActivityItem } from "@/lib/types";

const TYPE_META: Record<
  ActivityItem["type"],
  { Icon: React.ElementType; tint: string; label: string }
> = {
  reward: { Icon: Gift, tint: "text-neon-orange bg-neon-orange/12", label: "Reward" },
  withdrawal: { Icon: ArrowDownToLine, tint: "text-neon-cyan bg-neon-cyan/12", label: "Withdraw" },
  referral: { Icon: Users, tint: "text-purple-300 bg-purple-400/12", label: "Referral" },
  checkin: { Icon: CalendarCheck, tint: "text-emerald-300 bg-emerald-400/12", label: "Check-in" },
};

const FILTERS = ["ALL", "Rewards", "Withdrawals"] as const;

const STATUS_STYLE: Record<ActivityItem["status"], string> = {
  completed: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  paid: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  pending: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  processing: "text-neon-cyan border-neon-cyan/30 bg-neon-cyan/10",
  rejected: "text-rose-300 border-rose-500/30 bg-rose-500/10",
};

export function ActivityView() {
  const { activity, status } = useQuestify();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");

  const filtered = useMemo(() => {
    if (filter === "ALL") return activity;
    if (filter === "Rewards") return activity.filter((a) => a.type !== "withdrawal");
    return activity.filter((a) => a.type === "withdrawal");
  }, [activity, filter]);

  const totalIn = activity
    .filter((a) => a.amount_usdt > 0)
    .reduce((sum, a) => sum + a.amount_usdt, 0);
  const totalOut = activity
    .filter((a) => a.amount_usdt < 0)
    .reduce((sum, a) => sum + Math.abs(a.amount_usdt), 0);

  return (
    <div className="px-4 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <h1 className="text-xl font-bold tracking-tight text-white">Activity</h1>
      <p className="text-xs text-white/45">Rewards, referrals & withdrawals</p>

      <div className="mt-3.5 grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3.5">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Total earned</p>
          <p className="mt-0.5 text-lg font-bold text-emerald-400">
            +{formatUsdt(totalIn)}
          </p>
        </div>
        <div className="rounded-2xl border border-neon-cyan/20 bg-neon-cyan/[0.06] p-3.5">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Total withdrawn</p>
          <p className="mt-0.5 text-lg font-bold text-neon-cyan">
            -{formatUsdt(totalOut)}
          </p>
        </div>
      </div>

      <div className="mt-3.5 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-semibold transition",
              filter === f
                ? "border-neon-orange/50 bg-neon-orange/15 text-white"
                : "border-white/10 bg-white/[0.03] text-white/50",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {status === "loading" &&
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]"
            />
          ))}

        {filtered.map((item, i) => {
          const meta = TYPE_META[item.type];
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.25) }}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-xl"
            >
              <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", meta.tint)}>
                <meta.Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-white">{item.title}</p>
                <div className="mt-0.5 flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide",
                      STATUS_STYLE[item.status],
                    )}
                  >
                    {item.status}
                  </span>
                  <span className="text-[10px] text-white/35">{timeAgo(item.created_at)}</span>
                </div>
              </div>
              <div className="text-right">
                {item.amount_usdt !== 0 && (
                  <p
                    className={cn(
                      "text-sm font-bold",
                      item.amount_usdt > 0 ? "text-emerald-400" : "text-white/70",
                    )}
                  >
                    {item.amount_usdt > 0 ? "+" : ""}
                    {formatUsdt(item.amount_usdt)} USDT
                  </p>
                )}
                {item.amount_coins > 0 && (
                  <p className="flex items-center justify-end gap-0.5 text-[11px] font-semibold text-neon-orange">
                    <Coins className="h-3 w-3" />+{formatCoins(item.amount_coins)}
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}

        {status !== "loading" && filtered.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/50">
            No activity yet. Start completing tasks!
          </div>
        )}
      </div>
    </div>
  );
}
