"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Coins, CircleDollarSign, Check, Info, AlertTriangle, X, ArrowDownToLine } from "lucide-react";
import { useQuestify, type Toast } from "@/providers/QuestifyProvider";
import { formatCoins, formatUsdt } from "@/lib/utils";

export function RewardFloatLayer() {
  const { floaters } = useQuestify();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-1/3 z-[90] flex flex-col items-center gap-1">
      <AnimatePresence>
        {floaters.map((f, i) => (
          <motion.div
            key={f.id}
            initial={{ opacity: 0, y: 24, scale: 0.7 }}
            animate={{ opacity: 1, y: -40 - i * 8, scale: 1 }}
            exit={{ opacity: 0, y: -90, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 220, damping: 20 }}
            className="flex items-center gap-2 rounded-full border border-white/15 bg-black/60 px-3.5 py-1.5 backdrop-blur-xl"
          >
            {f.usdt > 0 && (
              <span className="flex items-center gap-1 text-sm font-bold text-emerald-400">
                <CircleDollarSign className="h-4 w-4" />+{formatUsdt(f.usdt)} USDT
              </span>
            )}
            {f.coins > 0 && (
              <span className="flex items-center gap-1 text-sm font-bold text-neon-orange">
                <Coins className="h-4 w-4" />+{formatCoins(f.coins)}
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function ConfettiLayer() {
  const { confetti } = useQuestify();

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[95] flex justify-center overflow-hidden">
      <AnimatePresence>
        {confetti && (
          <motion.div key={confetti.key} className="relative h-0 w-0">
            {confetti.pieces.map((p) => (
              <motion.span
                key={p.id}
                initial={{ opacity: 1, x: 0, y: 0, rotate: 0 }}
                animate={{ opacity: 0, x: p.x, y: p.y, rotate: p.r }}
                transition={{ duration: 1.6, delay: p.delay, ease: "easeOut" }}
                style={{
                  width: p.size,
                  height: p.size * 0.5,
                  background: p.color,
                  borderRadius: 2,
                  position: "absolute",
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const TOAST_ICON: Record<Toast["kind"], React.ElementType> = {
  success: Check,
  info: Info,
  warning: AlertTriangle,
  error: X,
};

const TOAST_STYLE: Record<Toast["kind"], string> = {
  success: "border-emerald-400/30 text-emerald-300",
  info: "border-neon-cyan/30 text-neon-cyan",
  warning: "border-amber-400/30 text-amber-300",
  error: "border-red-500/30 text-red-300",
};

export function ToastLayer() {
  const { toasts, actions } = useQuestify();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = TOAST_ICON[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
              className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border bg-black/70 px-3.5 py-2.5 backdrop-blur-xl ${TOAST_STYLE[t.kind]}`}
            >
              <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.06]">
                {t.amountUsdt ? (
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
                <span className="absolute inset-0 animate-ping rounded-full border border-current opacity-40" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{t.title}</p>
                {t.message && (
                  <p className="truncate text-xs text-white/55">{t.message}</p>
                )}
              </div>
              {t.amountUsdt ? (
                <span className="text-sm font-bold text-emerald-400">
                  {formatUsdt(t.amountUsdt)}
                </span>
              ) : null}
              <button
                onClick={() => actions.dismissToast(t.id)}
                className="text-white/40 transition active:scale-90"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
