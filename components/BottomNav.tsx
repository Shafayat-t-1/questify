"use client";

import { motion } from "framer-motion";
import { Activity, Home, ListChecks, Trophy, User } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabKey = "home" | "tasks" | "leaderboard" | "activity" | "profile";

const TABS: { key: TabKey; label: string; Icon: React.ElementType }[] = [
  { key: "home", label: "Home", Icon: Home },
  { key: "tasks", label: "Tasks", Icon: ListChecks },
  { key: "leaderboard", label: "Ranks", Icon: Trophy },
  { key: "activity", label: "Activity", Icon: Activity },
  { key: "profile", label: "Profile", Icon: User },
];

interface BottomNavProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-[70] flex justify-center px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="mb-2 flex w-full max-w-md items-center justify-around gap-1 rounded-3xl border border-white/10 bg-obsidian-soft/80 p-1.5 backdrop-blur-2xl shadow-[0_18px_50px_-12px_rgba(0,0,0,0.9)]">
        {TABS.map(({ key, label, Icon }) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              className="relative flex flex-1 flex-col items-center gap-1 rounded-2xl px-1 py-2 transition"
              aria-current={isActive ? "page" : undefined}
            >
              {isActive && (
                <motion.span
                  layoutId="nav-glow"
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                  className="absolute inset-0 rounded-2xl border border-neon-orange/40 bg-neon-orange/10 shadow-[0_0_22px_-4px_rgba(255,107,0,0.7)]"
                />
              )}
              <Icon
                className={cn(
                  "relative h-5 w-5 transition-colors",
                  isActive ? "text-neon-orange" : "text-white/45",
                )}
              />
              <span
                className={cn(
                  "relative text-[10px] font-semibold tracking-wide transition-colors",
                  isActive ? "text-white" : "text-white/40",
                )}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
