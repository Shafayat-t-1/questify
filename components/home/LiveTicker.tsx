"use client";

import { useQuestify } from "@/providers/QuestifyProvider";
import { formatUsdt, timeAgo } from "@/lib/utils";

export function LiveTicker() {
  const { ticker } = useQuestify();
  const items = ticker.length ? ticker : [];
  if (!items.length) return null;

  const loop = [...items, ...items];

  return (
    <div className="relative mt-3.5 overflow-hidden py-0.5">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-obsidian to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-obsidian to-transparent" />
      <div className="flex w-max animate-[marquee_38s_linear_infinite] items-center gap-2">
        {loop.map((event, i) => (
          <div
            key={`${event.id}-${i}`}
            className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 backdrop-blur-md"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[11px] font-medium text-white/70">
              <span className="font-semibold text-white">{event.masked_name}</span> just withdrew{" "}
              <span className="font-semibold text-emerald-400">
                {formatUsdt(event.amount_usdt)} USDT
              </span>
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-neon-cyan/80">
              {event.network}
            </span>
            <span className="text-[9px] text-white/30">{timeAgo(event.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
