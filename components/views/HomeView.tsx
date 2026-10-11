"use client";

import { motion } from "framer-motion";
import { ListChecks, Users, Zap } from "lucide-react";
import { HomeHeader } from "@/components/home/HomeHeader";
import { LiveTicker } from "@/components/home/LiveTicker";
import { DailyCheckinCard } from "@/components/home/DailyCheckinCard";
import { EventBanner } from "@/components/home/EventBanner";
import { HotTasks } from "@/components/home/HotTasks";
import { useQuestify } from "@/providers/QuestifyProvider";
import { compactNumber } from "@/lib/utils";
import type { Task } from "@/lib/types";

interface HomeViewProps {
  onStartTask: (task: Task) => void;
  onSeeAllTasks: () => void;
}

export function HomeView({ onStartTask, onSeeAllTasks }: HomeViewProps) {
  const { completedCount, totalTasks, profile } = useQuestify();

  const stats = [
    { label: "Completed", value: `${completedCount}/${totalTasks}`, Icon: ListChecks, color: "text-neon-cyan" },
    { label: "Referrals", value: compactNumber(profile?.referral_count ?? 0), Icon: Users, color: "text-neon-orange" },
    { label: "Level", value: `Lv.${profile?.level ?? 1}`, Icon: Zap, color: "text-amber-300" },
  ];

  return (
    <div className="px-4 pb-4">
      <HomeHeader />
      <div className="px-0">
        <LiveTicker />
      </div>
      <DailyCheckinCard />
      <EventBanner />

      <div className="mt-3.5 grid grid-cols-3 gap-2.5">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-center backdrop-blur-xl"
          >
            <s.Icon className={`mx-auto mb-1 h-4 w-4 ${s.color}`} />
            <p className="text-sm font-bold text-white">{s.value}</p>
            <p className="text-[10px] uppercase tracking-wider text-white/40">{s.label}</p>
          </motion.div>
        ))}
      </div>

      <HotTasks onStartTask={onStartTask} onSeeAll={onSeeAllTasks} />
    </div>
  );
}
