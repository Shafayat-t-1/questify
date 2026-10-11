"use client";

import { motion } from "framer-motion";
import { Coins, CircleDollarSign, ShieldCheck } from "lucide-react";
import { useQuestify } from "@/providers/QuestifyProvider";
import { Avatar } from "@/components/ui/Avatar";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { levelTitle } from "@/lib/utils";

export function HomeHeader() {
  const { profile } = useQuestify();

  const username = profile?.username ?? profile?.first_name ?? "Questify User";
  const level = profile?.level ?? 1;
  const usdt = profile?.usdt_balance ?? 0;
  const coins = profile?.coins ?? 0;

  return (
    <header className="px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-3">
        <Avatar src={profile?.photo_url} name={username} size={44} ring="rgba(255,107,0,0.6)" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold tracking-tight text-white">
              {username}
            </h1>
            {profile?.is_premium && (
              <span className="rounded-full border border-neon-cyan/40 bg-neon-cyan/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-neon-cyan">
                Premium
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="relative inline-flex items-center gap-1 rounded-md border border-white/15 bg-gradient-to-b from-white/15 to-white/[0.02] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
              <span className="bg-gradient-to-r from-amber-200 via-white to-amber-300 bg-clip-text text-transparent">
                Lv.{level}
              </span>
              <span className="font-semibold text-white/60">{levelTitle(level)}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400/90">
              <ShieldCheck className="h-3 w-3" />
              Trust {profile?.trust_score ?? 0}
            </span>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="mt-3.5 flex items-stretch gap-2"
      >
        <div className="flex flex-1 items-center gap-2.5 rounded-2xl border border-neon-cyan/25 bg-gradient-to-r from-neon-cyan/10 to-transparent px-3.5 py-2.5 backdrop-blur-xl">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-neon-cyan/15 text-neon-cyan">
            <CircleDollarSign className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-white/45">
              USDT Balance
            </p>
            <AnimatedNumber
              value={usdt}
              decimals={2}
              className="text-base font-bold text-white"
            />
          </div>
        </div>

        <div className="flex flex-1 items-center gap-2.5 rounded-2xl border border-neon-orange/25 bg-gradient-to-r from-neon-orange/10 to-transparent px-3.5 py-2.5 backdrop-blur-xl">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-neon-orange/15 text-neon-orange">
            <Coins className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-white/45">
              Quest Coins
            </p>
            <AnimatedNumber
              value={coins}
              decimals={0}
              className="text-base font-bold text-white"
            />
          </div>
        </div>
      </motion.div>
    </header>
  );
}
