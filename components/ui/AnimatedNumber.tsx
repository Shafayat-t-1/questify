"use client";

import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  duration?: number;
}

function withThousands(value: number, decimals: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function AnimatedNumber({
  value,
  decimals = 2,
  prefix = "",
  suffix = "",
  className,
  duration = 900,
}: AnimatedNumberProps) {
  const animated = useCountUp(value, duration, decimals);
  return (
    <span className={cn("tabular-nums", className)}>
      {prefix}
      {withThousands(animated, decimals)}
      {suffix}
    </span>
  );
}
