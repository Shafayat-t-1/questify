"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Timer, Trophy } from "lucide-react";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useQuestify } from "@/providers/QuestifyProvider";
import { EVENT_ENDS_AT, EVENT_TARGET_USDT } from "@/lib/seed";
import { formatCountdown, formatUsdt } from "@/lib/utils";

export function EventBanner() {
  const { eventRaised, squadBoost } = useQuestify();
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, (new Date(EVENT_ENDS_AT).getTime() - Date.now()) / 1000),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(Math.max(0, (new Date(EVENT_ENDS_AT).getTime() - Date.now()) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const raised = eventRaised + squadBoost * 0.5;
  const pct = Math.min(100, (raised / EVENT_TARGET_USDT) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative mt-3.5 overflow-hidden rounded-2xl border border-white/10 bg-obsidian-soft p-4"
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-neon-cyan/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-neon-orange/20 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,107,0,0.14),transparent_55%)]" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-amber-300/30 bg-gradient-to-br from-amber-300/30 to-neon-orange/20 text-amber-200">
            <Trophy className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">
              Season Event
            </p>
            <h3 className="text-base font-bold tracking-tight text-white">
              $200 USDT Prize Pool
            </h3>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] font-semibold text-neon-cyan">
          <Timer className="h-3 w-3" />
          {formatCountdown(remaining)}
        </div>
      </div>

      <div className="relative mt-4">
        <div className="mb-1.5 flex items-end justify-between">
          <span className="text-lg font-bold text-white">
            {formatUsdt(raised)}
            <span className="ml-1 text-xs font-medium text-white/45">
              / {EVENT_TARGET_USDT} USDT
            </span>
          </span>
          <span className="text-xs font-semibold text-neon-orange">{pct.toFixed(1)}%</span>
        </div>
        <ProgressBar value={pct} max={100} className="h-2.5" />
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">
          Complete tasks to feed the pool. Top 100 grinders split the prize the moment it fills.
        </p>
      </div>
    </motion.div>
  );
}
