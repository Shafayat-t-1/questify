"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Flame } from "lucide-react";
import { TaskItem } from "@/components/tasks/TaskItem";
import { TaskSkeleton } from "@/components/ui/Skeleton";
import { useQuestify } from "@/providers/QuestifyProvider";
import type { Task } from "@/lib/types";

interface HotTasksProps {
  onStartTask: (task: Task) => void;
  onSeeAll: () => void;
}

export function HotTasks({ onStartTask, onSeeAll }: HotTasksProps) {
  const { tasks, status } = useQuestify();

  const hot = useMemo(
    () =>
      [...tasks]
        .sort((a, b) => b.reward_usdt + b.reward_coins / 5000 - (a.reward_usdt + a.reward_coins / 5000))
        .slice(0, 3),
    [tasks],
  );

  return (
    <section className="mt-5">
      <div className="mb-2.5 flex items-center justify-between px-1">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <Flame className="h-4 w-4 text-neon-orange" /> Hot Tasks
        </h2>
        <button
          onClick={onSeeAll}
          className="flex items-center gap-0.5 text-[11px] font-semibold text-neon-cyan transition active:opacity-70"
        >
          See all <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-2.5">
        {status === "loading"
          ? Array.from({ length: 3 }).map((_, i) => <TaskSkeleton key={i} />)
          : hot.map((task, i) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <TaskItem task={task} onStart={onStartTask} variant="compact" />
              </motion.div>
            ))}
      </div>
    </section>
  );
}
