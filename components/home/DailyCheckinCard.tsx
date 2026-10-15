"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CalendarCheck, Check, Flame, Loader2, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { useQuestify } from "@/providers/QuestifyProvider";
import { buildCheckinSchedule } from "@/lib/checkin";
import { cn, formatCoins } from "@/lib/utils";

export function DailyCheckinCard() {
  const { checkin, actions, config } = useQuestify();
  const [claiming, setClaiming] = useState(false);
  const schedule = buildCheckinSchedule(
    config.checkinRewardSchedule,
    config.checkinMultiplierSchedule,
  );

  const handleClaim = async () => {
    if (checkin.hasToday || claiming) return;
    setClaiming(true);
    try {
      const res = await actions.claimCheckin();
      if (res.ok) {
        actions.pushToast({
          kind: "success",
          title: `Day ${checkin.nextDay} claimed`,
          message: `+${formatCoins(res.coins ?? 0)} Quest Coins`,
        });
      } else {
        actions.pushToast({ kind: "warning", title: "Check-in", message: res.message });
      }
    } catch {
      actions.pushToast({
        kind: "error",
        title: "Check-in failed",
        message: "Please try again in a moment",
      });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <GlassCard glow="orange" className="mt-3.5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-neon-orange/15 text-neon-orange">
            <CalendarCheck className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-white">Daily Check-in</h3>
            <p className="flex items-center gap-1 text-[11px] text-white/45">
              <Flame className="h-3 w-3 text-neon-orange" />
              {checkin.completedDays}/7 day streak
            </p>
          </div>
        </div>
        <span className="rounded-full border border-neon-orange/30 bg-neon-orange/10 px-2.5 py-1 text-[10px] font-bold text-neon-orange">
          x{checkin.multiplier.toFixed(1)} BONUS
        </span>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {schedule.map((day) => {
          const done = day.day <= checkin.completedDays;
          const isNext = day.day === checkin.nextDay && !checkin.hasToday;
          return (
            <motion.div
              key={day.day}
              animate={isNext ? { scale: [1, 1.06, 1] } : { scale: 1 }}
              transition={{ duration: 1.6, repeat: isNext ? Infinity : 0 }}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-xl border py-2",
                done
                  ? "border-neon-orange/40 bg-neon-orange/15"
                  : isNext
                    ? "border-neon-cyan/40 bg-neon-cyan/[0.07]"
                    : "border-white/10 bg-white/[0.02]",
              )}
            >
              {done ? (
                <Check className="h-4 w-4 text-neon-orange" />
              ) : (
                <span className={cn("text-[11px] font-bold", isNext ? "text-neon-cyan" : "text-white/40")}>
                  D{day.day}
                </span>
              )}
              <span className="text-[9px] font-medium text-white/50">{day.coins}</span>
            </motion.div>
          );
        })}
      </div>

      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={handleClaim}
        disabled={checkin.hasToday || claiming}
        className={cn(
          "mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition",
          checkin.hasToday
            ? "cursor-not-allowed border border-white/10 bg-white/[0.04] text-white/40"
            : "bg-gradient-to-r from-neon-orange to-amber-500 text-black shadow-[0_0_28px_-6px_rgba(255,107,0,0.9)]",
        )}
      >
        {claiming ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : checkin.hasToday ? (
          <>
            <Check className="h-4 w-4" /> Claimed today · come back tomorrow
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" /> Claim +{formatCoins(checkin.reward)} Coins
          </>
        )}
      </motion.button>
    </GlassCard>
  );
}
