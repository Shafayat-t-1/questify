"use client";

import { motion } from "framer-motion";
import { CardSkeleton, Skeleton, TaskSkeleton } from "@/components/ui/Skeleton";

export function BootSplash() {
  return (
    <div className="flex-1 px-4">
      <div className="mt-6 flex flex-col items-center">
        <motion.div
          animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.06, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          className="grid h-16 w-16 place-items-center rounded-2xl border border-neon-orange/40 bg-gradient-to-br from-neon-orange/30 to-neon-cyan/20 text-2xl font-black text-white shadow-[0_0_40px_-8px_rgba(255,107,0,0.8)]"
        >
          Q
        </motion.div>
        <h1 className="mt-3 bg-gradient-to-r from-white via-amber-100 to-white bg-clip-text text-lg font-bold tracking-tight text-transparent">
          Questify
        </h1>
        <p className="text-[11px] uppercase tracking-[0.25em] text-white/40">
          Securing your session
        </p>
      </div>

      <div className="mt-8 space-y-3">
        <CardSkeleton className="h-28" />
        <div className="grid grid-cols-3 gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <TaskSkeleton />
        <TaskSkeleton />
        <TaskSkeleton />
      </div>
    </div>
  );
}
