"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutGrid } from "lucide-react";
import { TaskItem } from "@/components/tasks/TaskItem";
import { TaskSkeleton } from "@/components/ui/Skeleton";
import { PLATFORM_META } from "@/components/icons/brand";
import { useQuestify } from "@/providers/QuestifyProvider";
import { cn } from "@/lib/utils";
import type { Platform, Task } from "@/lib/types";

type Filter = "ALL" | Platform;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "ALL" },
  { key: "telegram", label: "Telegram" },
  { key: "x", label: "X / Twitter" },
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube" },
  { key: "github", label: "GitHub" },
];

interface TasksViewProps {
  onStartTask: (task: Task) => void;
}

export function TasksView({ onStartTask }: TasksViewProps) {
  const { tasks, status, userTasks } = useQuestify();
  const [filter, setFilter] = useState<Filter>("ALL");

  const filtered = useMemo(() => {
    const list = filter === "ALL" ? tasks : tasks.filter((t) => t.platform === filter);
    return [...list].sort((a, b) => {
      const aDone = userTasks[a.id]?.status === "completed" ? 1 : 0;
      const bDone = userTasks[b.id]?.status === "completed" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return b.reward_usdt - a.reward_usdt;
    });
  }, [tasks, filter, userTasks]);

  const available = tasks.length - Object.values(userTasks).filter((t) => t.status === "completed").length;

  return (
    <div className="px-4 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Task Center</h1>
          <p className="text-xs text-white/45">
            {available} tasks available · earn coins & USDT
          </p>
        </div>

      </div>

      <div className="-mx-4 mt-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max items-center gap-2">
          {FILTERS.map((f) => {
            const isActive = filter === f.key;
            const meta = f.key !== "ALL" ? PLATFORM_META[f.key] : null;
            const Icon = meta?.Icon;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "relative flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition",
                  isActive
                    ? "border-neon-orange/50 bg-neon-orange/15 text-white"
                    : "border-white/10 bg-white/[0.03] text-white/55",
                )}
              >
                {Icon ? <Icon className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {status === "loading" ? (
          Array.from({ length: 5 }).map((_, i) => <TaskSkeleton key={i} />)
        ) : (
          <AnimatePresence mode="popLayout">
            {filtered.map((task, i) => (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ delay: Math.min(i * 0.03, 0.2) }}
              >
                <TaskItem task={task} onStart={onStartTask} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        {status !== "loading" && filtered.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <p className="text-sm text-white/50">No tasks in this category yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
