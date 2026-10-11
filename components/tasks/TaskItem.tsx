"use client";

import { motion } from "framer-motion";
import { Check, Coins, CircleDollarSign, Zap } from "lucide-react";
import { PLATFORM_META } from "@/components/icons/brand";
import { useQuestify } from "@/providers/QuestifyProvider";
import { cn, formatCoins, formatUsdt } from "@/lib/utils";
import type { Task } from "@/lib/types";

interface TaskItemProps {
  task: Task;
  onStart: (task: Task) => void;
  variant?: "full" | "compact";
}

const DIFFICULTY_STYLE: Record<Task["difficulty"], string> = {
  easy: "border-emerald-400/30 text-emerald-300",
  medium: "border-amber-400/30 text-amber-300",
  hard: "border-rose-500/30 text-rose-300",
};

export function TaskItem({ task, onStart, variant = "full" }: TaskItemProps) {
  const { userTasks } = useQuestify();
  const meta = PLATFORM_META[task.platform];
  const Icon = meta.Icon;
  const completed = userTasks[task.id]?.status === "completed";
  const compact = variant === "compact";

  return (
    <motion.div
      layout
      whileTap={{ scale: 0.995 }}
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl",
        compact ? "p-3" : "p-3.5",
      )}
    >
      <span
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border"
        style={{ borderColor: meta.ring, background: meta.soft, color: meta.color }}
      >
        <Icon className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-[13px] font-semibold text-white">{task.title}</h3>
        </div>
        {!compact && task.description && (
          <p className="mt-0.5 truncate text-[11px] text-white/45">{task.description}</p>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <span className="flex items-center gap-0.5 text-[11px] font-bold text-neon-orange">
            <Coins className="h-3 w-3" />+{formatCoins(task.reward_coins)}
          </span>
          <span className="flex items-center gap-0.5 text-[11px] font-bold text-emerald-400">
            <CircleDollarSign className="h-3 w-3" />+{formatUsdt(task.reward_usdt)}
          </span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide",
              DIFFICULTY_STYLE[task.difficulty],
            )}
          >
            {task.difficulty}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/50">
          {task.action_label}
        </span>
        {completed ? (
          <span className="flex items-center gap-1 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] font-bold text-emerald-300">
            <Check className="h-3.5 w-3.5" /> Done
          </span>
        ) : (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => onStart(task)}
            className="flex items-center gap-1 rounded-xl bg-gradient-to-r from-neon-orange to-amber-500 px-3 py-2 text-[11px] font-bold text-black shadow-[0_0_18px_-6px_rgba(255,107,0,0.9)]"
          >
            <Zap className="h-3.5 w-3.5" /> Start
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}
