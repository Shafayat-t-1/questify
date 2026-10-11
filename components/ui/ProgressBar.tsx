"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  max?: number;
  className?: string;
  barClassName?: string;
  showGlow?: boolean;
}

export function ProgressBar({
  value,
  max = 100,
  className,
  barClassName,
  showGlow = true,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-white/[0.06]",
        className,
      )}
    >
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ type: "spring", stiffness: 80, damping: 20 }}
        className={cn(
          "relative h-full rounded-full bg-gradient-to-r from-neon-orange to-amber-400",
          showGlow && "shadow-[0_0_14px_rgba(255,107,0,0.7)]",
          barClassName,
        )}
      >
        <span className="absolute inset-0 animate-[shimmer_2.2s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
      </motion.div>
    </div>
  );
}
