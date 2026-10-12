"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { QuestifyProvider, useQuestify } from "@/providers/QuestifyProvider";
import { BottomNav, type TabKey } from "@/components/BottomNav";
import { HomeView } from "@/components/views/HomeView";
import { TasksView } from "@/components/views/TasksView";
import { LeaderboardView } from "@/components/views/LeaderboardView";
import { ActivityView } from "@/components/views/ActivityView";
import { ProfileView } from "@/components/views/ProfileView";
import { VerifyModal } from "@/components/tasks/VerifyModal";
import { WithdrawModal } from "@/components/wallet/WithdrawModal";
import {
  ConfettiLayer,
  RewardFloatLayer,
  ToastLayer,
} from "@/components/ui/Effects";
import { BootSplash } from "@/components/ui/BootSplash";
import { useTelegram } from "@/hooks/useTelegram";
import type { Task } from "@/lib/types";

function Shell() {
  const { status } = useQuestify();
  const { haptic, selection } = useTelegram();
  const [tab, setTab] = useState<TabKey>("home");
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const changeTab = (next: TabKey) => {
    if (next === tab) return;
    selection();
    setTab(next);
  };

  const startTask = (task: Task) => {
    haptic("light");
    setActiveTask(task);
  };

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <div className="h-3 pt-[max(0.5rem,env(safe-area-inset-top))]"></div>

      {status === "loading" ? (
        <BootSplash />
      ) : (
        <main className="flex-1 pb-28">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {tab === "home" && (
                <HomeView onStartTask={startTask} onSeeAllTasks={() => changeTab("tasks")} />
              )}
              {tab === "tasks" && <TasksView onStartTask={startTask} />}
              {tab === "leaderboard" && <LeaderboardView />}
              {tab === "activity" && <ActivityView />}
              {tab === "profile" && <ProfileView onOpenWithdraw={() => setWithdrawOpen(true)} />}
            </motion.div>
          </AnimatePresence>
        </main>
      )}

      <BottomNav active={tab} onChange={changeTab} />

      <VerifyModal task={activeTask} onClose={() => setActiveTask(null)} />
      <WithdrawModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
      <RewardFloatLayer />
      <ConfettiLayer />
      <ToastLayer />
    </div>
  );
}

export function QuestifyApp() {
  return (
    <QuestifyProvider>
      <Shell />
    </QuestifyProvider>
  );
}
