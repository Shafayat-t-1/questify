"use client";

import { motion } from "framer-motion";
import { Crown, Medal, TrendingUp, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useQuestify } from "@/providers/QuestifyProvider";
import { cn, formatUsdt, levelTitle } from "@/lib/utils";
import type { LeaderboardEntry } from "@/lib/types";

const PODIUM = [
  { place: 2, ring: "#C0C7D1", glow: "rgba(192,199,209,0.55)", label: "Silver", h: 84 },
  { place: 1, ring: "#FFD166", glow: "rgba(255,209,102,0.7)", label: "Gold", h: 104 },
  { place: 3, ring: "#E08A4A", glow: "rgba(224,138,74,0.55)", label: "Bronze", h: 68 },
];

function PodiumCard({ entry, meta, index }: { entry?: LeaderboardEntry; meta: (typeof PODIUM)[number]; index: number }) {
  if (!entry) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.08 * index + 0.1, type: "spring", stiffness: 180, damping: 18 }}
      className="flex flex-1 flex-col items-center"
    >
      <div className="relative">
        {meta.place === 1 && (
          <motion.span
            animate={{ y: [-2, 2, -2] }}
            transition={{ duration: 2.4, repeat: Infinity }}
            className="absolute -top-5 left-1/2 -translate-x-1/2 text-amber-300"
          >
            <Crown className="h-5 w-5" />
          </motion.span>
        )}
        <Avatar
          src={entry.photo_url}
          name={entry.username}
          size={meta.place === 1 ? 62 : 52}
          ring={meta.ring}
          className="shadow-lg"
        />
        <span
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-white/20 px-1.5 py-px text-[9px] font-bold text-black"
          style={{ background: meta.ring }}
        >
          #{meta.place}
        </span>
      </div>
      <p className="mt-3 max-w-[80px] truncate text-xs font-semibold text-white">
        {entry.username}
      </p>
      <p className="text-[10px] text-white/40">Lv.{entry.level}</p>
      <div
        className="mt-2 w-full rounded-t-xl border border-b-0 border-white/10 bg-gradient-to-b from-white/[0.08] to-transparent"
        style={{ height: meta.h, boxShadow: `0 0 30px -8px ${meta.glow}` }}
      >
        <p className="pt-2 text-center text-[11px] font-bold text-emerald-400">
          {formatUsdt(entry.usdt_earned)}
        </p>
        <p className="text-center text-[9px] uppercase tracking-wider text-white/35">USDT</p>
      </div>
    </motion.div>
  );
}

export function LeaderboardView() {
  const { leaderboard } = useQuestify();

  const byRank = (r: number) => leaderboard.find((e) => e.rank === r);
  const rest = leaderboard.filter((e) => e.rank > 3);
  const me = leaderboard.find((e) => e.is_me);
  const globalPos = me?.rank ?? leaderboard.length;

  return (
    <div className="px-4 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Leaderboard</h1>
          <p className="text-xs text-white/45">Season 1 · resets in 6 days</p>
        </div>
        <span className="flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
          <Medal className="h-3 w-3" /> Top 100 rewarded
        </span>
      </div>

      <div className="mt-5 flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 pb-0 backdrop-blur-xl">
        {PODIUM.map((meta, i) => (
          <PodiumCard key={meta.place} entry={byRank(meta.place)} meta={meta} index={i} />
        ))}
      </div>

      {me && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3.5 flex items-center gap-3 rounded-2xl border border-neon-orange/30 bg-gradient-to-r from-neon-orange/12 to-transparent p-3.5 backdrop-blur-xl"
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-neon-orange/15 text-lg font-bold text-neon-orange">
            #{globalPos}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-white/50">Your global position</p>
            <p className="truncate text-sm font-semibold text-white">
              {me.username} · {levelTitle(me.level)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-emerald-400">{formatUsdt(me.usdt_earned)}</p>
            <p className="flex items-center justify-end gap-0.5 text-[10px] text-white/40">
              <Users className="h-3 w-3" /> {me.referrals}
            </p>
          </div>
        </motion.div>
      )}

      <div className="mt-4 space-y-2">
        {rest.map((entry, i) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.25) }}
            className={cn(
              "flex items-center gap-3 rounded-2xl border p-3 backdrop-blur-xl",
              entry.is_me
                ? "border-neon-cyan/40 bg-neon-cyan/[0.07]"
                : "border-white/10 bg-white/[0.03]",
            )}
          >
            <span className="w-6 text-center text-sm font-bold text-white/50">
              {entry.rank}
            </span>
            <Avatar src={entry.photo_url} name={entry.username} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {entry.username} {entry.is_me && <span className="text-neon-cyan">(you)</span>}
              </p>
              <p className="flex items-center gap-2 text-[11px] text-white/40">
                <span>Lv.{entry.level}</span>
                <span className="flex items-center gap-0.5">
                  <Users className="h-3 w-3" /> {entry.referrals}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-1 text-sm font-bold text-emerald-400">
              <TrendingUp className="h-3.5 w-3.5" />
              {formatUsdt(entry.usdt_earned)}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
