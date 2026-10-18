"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, ExternalLink, Link2, Loader2, ShieldCheck, Timer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { GitHubIcon, PLATFORM_META } from "@/components/icons/brand";
import { useQuestify } from "@/providers/QuestifyProvider";
import { useTelegram } from "@/hooks/useTelegram";
import { authHeaders } from "@/lib/session-client";
import { cn, formatCoins, formatUsdt, safeExternalUrl } from "@/lib/utils";
import type { Task } from "@/lib/types";

interface VerifyModalProps {
  task: Task | null;
  onClose: () => void;
}

export function VerifyModal({ task, onClose }: VerifyModalProps) {
  if (!task) return null;
  const meta = PLATFORM_META[task.platform];
  return (
    <Modal open onClose={onClose} title="Complete the action" subtitle={meta.label}>
      <VerifyBody key={task.id} task={task} onClose={onClose} />
    </Modal>
  );
}

function VerifyBody({ task, onClose }: { task: Task; onClose: () => void }) {
  const { actions, userTasks, connectedAccounts } = useQuestify();
  const { openLink, haptic, notify } = useTelegram();

  const [opened, setOpened] = useState(false);
  const [remaining, setRemaining] = useState(task.duration_seconds);
  const [submitting, setSubmitting] = useState(false);
  const [linkingGitHub, setLinkingGitHub] = useState(false);
  const timerRef = useRef<number | null>(null);

  const completed = userTasks[task.id]?.status === "completed";
  const meta = PLATFORM_META[task.platform];
  const Icon = meta.Icon;
  const actionUrl = safeExternalUrl(task.action_url);

  // Phase 4A: github_star / github_fork tasks are verified against the GitHub
  // API using the account from a REAL OAuth link. Without one the claim is
  // guaranteed to fail with `github_not_linked` — say so up front instead of
  // letting the user burn the timer and get rejected at claim time.
  const needsGitHubLink =
    !completed &&
    (task.verification_type === "github_star" || task.verification_type === "github_fork") &&
    !connectedAccounts.some((a) => a.provider === "github");

  const startGitHubLink = async () => {
    if (linkingGitHub) return;
    setLinkingGitHub(true);
    haptic("light");
    try {
      const res = await fetch("/api/oauth/github/start", {
        method: "GET",
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; authorizeUrl?: string };
      if (res.ok && json.ok && json.authorizeUrl) {
        window.location.assign(json.authorizeUrl);
        return;
      }
      actions.pushToast({
        kind: "error",
        title: "GitHub sign-in failed",
        message:
          res.status === 429
            ? "Too many attempts — wait a minute and try again."
            : "Could not start GitHub sign-in. Please try again.",
      });
    } catch {
      actions.pushToast({
        kind: "error",
        title: "GitHub sign-in failed",
        message: "Network error — please try again.",
      });
    } finally {
      setLinkingGitHub(false);
    }
  };

  useEffect(() => {
    if (!opened || remaining <= 0) return;
    timerRef.current = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          notify("success");
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [opened, remaining, notify]);

  const progress = task.duration_seconds
    ? ((task.duration_seconds - remaining) / task.duration_seconds) * 100
    : 100;

  const handleOpen = () => {
    if (!actionUrl) {
      actions.pushToast({
        kind: "warning",
        title: "Unavailable",
        message: "This task has an invalid action link",
      });
      return;
    }
    haptic("medium");
    openLink(actionUrl);
    setOpened(true);
    if (task.duration_seconds <= 0) setRemaining(0);
    // Register the server-side "started" marker so the duration gate is enforced
    // on the database clock — a forged instant claim cannot pass it.
    void actions.startTask(task).then((res) => {
      if (!res.ok) {
        actions.pushToast({
          kind: "warning",
          title: "Couldn't start task",
          message: res.message ?? "Please try again",
        });
      }
    });
  };

  const handleClaim = async () => {
    setSubmitting(true);
    try {
      const res = await actions.completeTask(task);
      if (res.ok) {
        actions.pushToast({
          kind: "success",
          title: "Task verified",
          message: `+${formatCoins(res.coins ?? 0)} coins · +${formatUsdt(res.usdt ?? 0)} USDT`,
        });
        haptic("heavy");
        onClose();
      } else {
        actions.pushToast({ kind: "warning", title: "Cannot claim", message: res.message });
      }
    } catch {
      actions.pushToast({
        kind: "error",
        title: "Cannot claim",
        message: "Please try again in a moment",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col items-center text-center">
      <span
        className="grid h-16 w-16 place-items-center rounded-2xl border"
        style={{ borderColor: meta.ring, background: meta.soft, color: meta.color }}
      >
        <Icon className="h-7 w-7" />
      </span>
      <h3 className="mt-3 text-base font-semibold text-white">{task.title}</h3>
      {task.description && (
        <p className="mt-1 text-xs leading-relaxed text-white/50">{task.description}</p>
      )}

      <div className="mt-4 flex w-full items-stretch gap-2">
        <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Reward Coins</p>
          <p className="text-sm font-bold text-neon-orange">+{formatCoins(task.reward_coins)}</p>
        </div>
        <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Reward USDT</p>
          <p className="text-sm font-bold text-emerald-400">+{formatUsdt(task.reward_usdt)}</p>
        </div>
      </div>

      {opened && remaining > 0 && (
        <div className="mt-4 w-full">
          <div className="mb-1.5 flex items-center justify-between text-xs text-white/50">
            <span className="flex items-center gap-1">
              <Timer className="h-3 w-3" /> Verifying action…
            </span>
            <span className="font-semibold tabular-nums text-neon-cyan">{remaining}s</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-cyan-300"
              animate={{ width: `${progress}%` }}
              transition={{ ease: "linear", duration: 0.9 }}
            />
          </div>
        </div>
      )}

      <div className="mt-5 w-full space-y-2">
        {needsGitHubLink ? (
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3 text-left">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
              <Link2 className="h-3.5 w-3.5" /> GitHub link required
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/55">
              Star and fork tasks are verified through the GitHub API using a real OAuth
              sign-in. Link your GitHub account first, then reopen this task.
            </p>
            <button
              onClick={() => void startGitHubLink()}
              disabled={linkingGitHub}
              className={cn(
                "mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-neon-orange to-amber-500 py-2.5 text-xs font-bold text-black transition active:scale-[0.98]",
                linkingGitHub && "opacity-70",
              )}
            >
              {linkingGitHub ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitHubIcon className="h-3.5 w-3.5" />
              )}
              {linkingGitHub ? "Opening GitHub…" : "Link GitHub to continue"}
            </button>
          </div>
        ) : (
          <>
            {!completed && (
              <button
                onClick={handleOpen}
                disabled={!actionUrl}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] py-3 text-sm font-semibold text-white transition active:scale-[0.98]",
                  !actionUrl && "cursor-not-allowed opacity-50",
                )}
              >
                <ExternalLink className="h-4 w-4" />
                {opened ? "Reopen action" : `Open ${meta.label} & Start`}
              </button>
            )}

            <button
              onClick={handleClaim}
              disabled={completed || !opened || remaining > 0 || submitting}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition active:scale-[0.98]",
                completed
                  ? "cursor-not-allowed border border-white/10 bg-white/[0.04] text-white/40"
                  : !opened || remaining > 0
                    ? "cursor-not-allowed border border-white/10 bg-white/[0.04] text-white/35"
                    : "bg-gradient-to-r from-neon-orange to-amber-500 text-black shadow-[0_0_28px_-6px_rgba(255,107,0,0.9)]",
              )}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : completed ? (
                <>
                  <Check className="h-4 w-4" /> Already completed
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  {remaining > 0 ? `Verify in ${remaining}s` : "Verify & Claim"}
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
