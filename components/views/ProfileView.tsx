"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  Check,
  Copy,
  Coins,
  CircleDollarSign,
  Crown,
  ShieldCheck,
  Share2,
  TrendingUp,
  Users,
  Wallet as WalletIcon,
  Link2,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import {
  GoogleIcon,
  TelegramIcon,
  XIcon,
  GitHubIcon,
  RedditIcon,
  DiscordIcon,
  YouTubeIcon,
  TikTokIcon,
} from "@/components/icons/brand";
import { useQuestify } from "@/providers/QuestifyProvider";
import { useTelegram } from "@/hooks/useTelegram";
import { referralLink, referralShareUrl } from "@/lib/config";
import { cn, formatCoins, formatUsdt, levelTitle, timeAgo } from "@/lib/utils";
import type { ActivityItem } from "@/lib/types";

interface ProfileViewProps {
  onOpenWithdraw: () => void;
}

function TrustRing({ score }: { score: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = score >= 70 ? "#34d399" : score >= 40 ? "#FF6B00" : "#f43f5e";
  return (
    <div className="relative grid h-20 w-20 place-items-center">
      <svg className="h-20 w-20 -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <motion.circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-lg font-bold text-white">{score}</p>
        <p className="text-[8px] uppercase tracking-wider text-white/40">Trust</p>
      </div>
    </div>
  );
}

const PROVIDERS = [
  { key: "telegram" as const, label: "Telegram", Icon: TelegramIcon },
  { key: "google" as const, label: "Google", Icon: GoogleIcon },
  { key: "x" as const, label: "X / Twitter", Icon: XIcon },
  { key: "github" as const, label: "GitHub", Icon: GitHubIcon },
  { key: "reddit" as const, label: "Reddit", Icon: RedditIcon },
  { key: "discord" as const, label: "Discord", Icon: DiscordIcon },
  { key: "youtube" as const, label: "YouTube", Icon: YouTubeIcon },
  { key: "tiktok" as const, label: "TikTok", Icon: TikTokIcon },
];

const ACTIVITY_TINT: Record<ActivityItem["type"], string> = {
  reward: "text-neon-orange",
  withdrawal: "text-neon-cyan",
  referral: "text-purple-300",
  checkin: "text-emerald-300",
};

export function ProfileView({ onOpenWithdraw }: ProfileViewProps) {
  const { profile, wallet, activity, actions, config, connectedAccounts } = useQuestify();
  const { haptic, openLink } = useTelegram();
  const [linking, setLinking] = useState<string | null>(null);
  const [form, setForm] = useState<{ username?: string; profile_url?: string }>({});

  const username = profile?.username ?? profile?.first_name ?? "Questify User";
  const referralCode = profile?.referral_code ?? "";
  const refLink = referralLink(config, referralCode);
  const estCoinValue = (profile?.coins ?? 0) * config.coinToUsdtRate;
  const linkedProviders = new Set(connectedAccounts.map((a) => a.provider));

  const copyReferral = () => {
    haptic("light");
    actions.pushToast({ kind: "success", title: "Referral link copied", message: `via @${config.botUsername}` });
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(refLink);
    }
  };

  const shareReferral = () => {
    haptic("medium");
    openLink(referralShareUrl(config, referralCode));
  };

  return (
    <div className="px-4 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <h1 className="text-xl font-bold tracking-tight text-white">Profile & Wallet</h1>

      <div className="mt-3.5 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
        <Avatar src={profile?.photo_url} name={username} size={64} ring="rgba(255,107,0,0.55)" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-base font-semibold text-white">{username}</h2>
            {profile?.is_premium && <BadgeCheck className="h-4 w-4 text-neon-cyan" />}
          </div>
          {profile?.is_founder && (
            <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-amber-200">
              <Crown className="h-2.5 w-2.5" /> Founder &amp; Supreme Owner
            </span>
          )}
          <p className="text-xs text-white/45">
            Lv.{profile?.level ?? 1} · {levelTitle(profile?.level ?? 1)}
          </p>
          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-white/50">
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" /> {profile?.referral_count ?? 0} referrals
            </span>
            <span className="flex items-center gap-1 text-neon-orange">
              <Coins className="h-3 w-3" /> {formatCoins(profile?.coins ?? 0)}
            </span>
          </div>
        </div>
        <TrustRing score={profile?.trust_score ?? 0} />
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={copyReferral}
          className="flex flex-1 items-center justify-between rounded-2xl border border-dashed border-neon-orange/40 bg-neon-orange/[0.06] px-3.5 py-2.5 transition active:scale-[0.99]"
        >
          <div className="min-w-0 text-left">
            <p className="text-[10px] uppercase tracking-wider text-white/40">Your referral link</p>
            <p className="truncate text-xs font-semibold text-white">
              {referralCode ? refLink.replace(/^https?:\/\//, "") : `@${config.botUsername}`}
            </p>
          </div>
          <span className="ml-2 flex shrink-0 items-center gap-1 text-xs font-semibold text-neon-orange">
            <Copy className="h-3.5 w-3.5" /> Copy
          </span>
        </button>
        <button
          onClick={shareReferral}
          aria-label="Share referral link"
          className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-neon-orange to-amber-500 text-black shadow-[0_0_24px_-8px_rgba(255,107,0,0.9)] transition active:scale-95"
        >
          <Share2 className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <WalletIcon className="h-4 w-4 text-neon-cyan" /> Wallet Balance
          </h3>
          <span className="flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
            <ShieldCheck className="h-3 w-3" /> Secured
          </span>
        </div>

        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-white/40">Withdrawable</p>
            <p className="text-2xl font-bold tracking-tight text-white">
              {formatUsdt(profile?.usdt_balance ?? 0)}
              <span className="ml-1 text-sm font-medium text-white/45">USDT</span>
            </p>
          </div>
          <div className="text-right">
            <p className="flex items-center justify-end gap-1 text-xs font-semibold text-neon-orange">
              <Coins className="h-3.5 w-3.5" /> {formatCoins(profile?.coins ?? 0)} Coins
            </p>
            <p className="text-[10px] text-white/40">≈ {formatUsdt(estCoinValue)} USDT</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5 text-[11px]">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-white/40">BEP-20</p>
            <p className="truncate font-medium text-white/80">
              {wallet?.usdt_bep20 ? `${wallet.usdt_bep20.slice(0, 6)}…${wallet.usdt_bep20.slice(-4)}` : "Not set"}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-white/40">TON</p>
            <p className="truncate font-medium text-white/80">
              {wallet?.ton_address ? `${wallet.ton_address.slice(0, 6)}…${wallet.ton_address.slice(-4)}` : "Not set"}
            </p>
          </div>
        </div>

        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            haptic("medium");
            onOpenWithdraw();
          }}
          className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-neon-orange to-amber-500 py-3.5 text-sm font-bold text-black shadow-[0_0_28px_-6px_rgba(255,107,0,0.9)]"
        >
          <TrendingUp className="h-4 w-4" /> WITHDRAW
        </motion.button>
      </div>

      <div className="mt-4">
        <h3 className="mb-2 px-1 text-sm font-semibold text-white">Linked Accounts</h3>
        <div className="grid grid-cols-3 gap-2.5">
          {PROVIDERS.map((acc) => {
            const connected =
              acc.key === "telegram" ? Boolean(profile) : linkedProviders.has(acc.key);
            return (
              <div
                key={acc.key}
                className={cn(
                  "relative flex flex-col items-center gap-1.5 rounded-2xl border p-3",
                  connected
                    ? "border-emerald-400/25 bg-emerald-400/[0.06]"
                    : "border-white/10 bg-white/[0.03]",
                )}
              >
                {connected && (
                  <span className="absolute right-2 top-2 grid h-4 w-4 place-items-center rounded-full bg-emerald-400 text-black">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
                <acc.Icon className="h-6 w-6" />
                <span className="text-[11px] font-medium text-white/70">{acc.label}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (connected) return;
                    haptic("light");
                    setLinking(acc.key);
                    setForm({});
                  }}
                  className={cn(
                    "text-[9px] font-bold uppercase",
                    connected ? "cursor-default text-emerald-300" : "text-white/60 hover:text-white",
                  )}
                >
                  {connected ? "Linked" : "Connect"}
                </button>
              </div>
            );
          })}
        </div>
        {linking && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-white flex items-center gap-1">
                <Link2 className="h-3.5 w-3.5" /> Link {linking}
              </h4>
              <button className="text-[10px] text-white/40" onClick={() => setLinking(null)}>
                Cancel
              </button>
            </div>
            <p className="text-[10px] text-white/40">
              Enter your username or profile link for verification. This is a fallback when OAuth isn&apos;t configured.
            </p>
            <input
              className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-white placeholder:text-white/30"
              placeholder={`@username or profile URL for ${linking}`}
              value={form.profile_url || form.username || ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("http")) setForm({ profile_url: v });
                else setForm({ username: v.replace(/^@/, "") });
              }}
            />
            <button
              className="w-full rounded-lg bg-gradient-to-r from-neon-orange to-amber-500 py-2 text-xs font-bold text-black"
              onClick={async () => {
                await actions.linkAccount(linking, form);
                setLinking(null);
              }}
            >
              Save link
            </button>
          </div>
        )}
      </div>

      <div className="mt-4">
        <h3 className="mb-2 px-1 text-sm font-semibold text-white">Transaction & Reward History</h3>
        <div className="space-y-2">
          {activity.slice(0, 5).map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-xl"
            >
              <span className={cn("grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05]", ACTIVITY_TINT[item.type])}>
                <CircleDollarSign className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white">{item.title}</p>
                <p className="text-[10px] text-white/35">{timeAgo(item.created_at)}</p>
              </div>
              <span
                className={cn(
                  "text-sm font-bold",
                  item.amount_usdt < 0 ? "text-white/60" : item.amount_usdt > 0 ? "text-emerald-400" : "text-neon-orange",
                )}
              >
                {item.amount_usdt !== 0
                  ? `${item.amount_usdt > 0 ? "+" : ""}${formatUsdt(item.amount_usdt)}`
                  : `+${formatCoins(item.amount_coins)}`}
              </span>
            </div>
          ))}
          {activity.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/50">
              No transactions yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
