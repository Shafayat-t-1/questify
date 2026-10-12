"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTelegram } from "@/hooks/useTelegram";
import {
  ApiError,
  fetchLeaderboard,
  fetchMe,
  fetchRuntimeConfig,
  fetchTasks,
  fetchTicker,
  rpcClaimCheckin,
  rpcClaimTask,
  rpcStartTask,
  rpcWithdraw,
  saveWallet,
  type ClaimResult,
} from "@/lib/data";
import { CHECKIN_SCHEDULE } from "@/lib/checkin";
import { envConfig, type PublicConfig } from "@/lib/config";
import { authHeaders, setInitData, setSessionToken } from "@/lib/session-client";
import { isSupabaseConfigured } from "@/lib/supabase";
import type {
  ActivityItem,
  AuthResponse,
  ConnectedAccount,
  DailyCheckin,
  LeaderboardEntry,
  Profile,
  Task,
  TickerEvent,
  UserTask,
  Wallet,
  Withdrawal,
} from "@/lib/types";

type Status = "loading" | "ready" | "error";

export interface Floater {
  id: string;
  coins: number;
  usdt: number;
}

export interface Toast {
  id: string;
  kind: "success" | "info" | "warning" | "error";
  title: string;
  message?: string;
  amountUsdt?: number;
}

export interface ConfettiPiece {
  id: number;
  x: number;
  y: number;
  r: number;
  delay: number;
  size: number;
  color: string;
}

export interface Confetti {
  key: number;
  pieces: ConfettiPiece[];
}

const CONFETTI_COLORS = ["#FF6B00", "#00F0FF", "#FFD166", "#ffffff", "#FF9F1C"];

interface ActionResult {
  ok: boolean;
  message?: string;
  coins?: number;
  usdt?: number;
}

export interface QuestifyContextValue {
  status: Status;
  isInTelegram: boolean;
  isLive: boolean;
  profile: Profile | null;
  wallet: Wallet | null;
  tasks: Task[];
  userTasks: Record<string, UserTask>;
  leaderboard: LeaderboardEntry[];
  ticker: TickerEvent[];
  activity: ActivityItem[];
  checkins: DailyCheckin[];
  checkin: {
    hasToday: boolean;
    completedDays: number;
    nextDay: number;
    reward: number;
    multiplier: number;
  };
  totalTasks: number;
  completedCount: number;
  floaters: Floater[];
  toasts: Toast[];
  confetti: Confetti | null;
  config: PublicConfig;
  connectedAccounts: ConnectedAccount[];
  actions: {
    startTask: (task: Task) => Promise<ActionResult>;
    completeTask: (task: Task) => Promise<ActionResult>;
    claimCheckin: () => Promise<ActionResult>;
    requestWithdrawal: (
      amount: number,
      network: Withdrawal["network"],
      address: string,
    ) => Promise<ActionResult>;
    updateWallet: (patch: Partial<Wallet>) => Promise<ActionResult>;
    applyReferral: (code: string) => void;
    linkAccount: (
      provider: string,
      payload: { username?: string; profile_url?: string; provider_user_id?: string },
    ) => Promise<ActionResult>;
    dismissFloater: (id: string) => void;
    dismissToast: (id: string) => void;
    pushToast: (toast: Omit<Toast, "id">) => void;
    refresh: () => Promise<void>;
  };
}

const QuestifyContext = createContext<QuestifyContextValue | null>(null);

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function deriveCheckin(checkins: DailyCheckin[]) {
  const today = dateKey(new Date());
  const yesterday = dateKey(new Date(Date.now() - 86_400_000));
  const sorted = [...checkins].sort(
    (a, b) => +new Date(b.checked_in_at) - +new Date(a.checked_in_at),
  );
  const last = sorted[0];
  const lastKey = last ? dateKey(new Date(last.checked_in_at)) : null;

  const hasToday = lastKey === today;
  let completedDays = 0;
  let nextDay = 1;

  if (last) {
    if (lastKey === today) {
      completedDays = last.day_index;
      nextDay = last.day_index % 7 + 1;
    } else if (lastKey === yesterday) {
      completedDays = last.day_index;
      nextDay = last.day_index % 7 + 1;
    }
  }

  const schedule = CHECKIN_SCHEDULE[nextDay - 1] ?? CHECKIN_SCHEDULE[0];
  return {
    hasToday,
    completedDays,
    nextDay,
    reward: schedule.coins,
    multiplier: schedule.multiplier,
  };
}

let uid = 0;
const nextId = () => `${Date.now().toString(36)}-${(uid++).toString(36)}`;

/** Human-readable message for any thrown action error. */
function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Please try again.";
}

export function QuestifyProvider({ children }: { children: React.ReactNode }) {
  const { initData, referralCode, haptic, isInTelegram, isReady, user: tgUser } =
    useTelegram();

  const [status, setStatus] = useState<Status>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [userTasks, setUserTasks] = useState<Record<string, UserTask>>({});
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [ticker, setTicker] = useState<TickerEvent[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [checkins, setCheckins] = useState<DailyCheckin[]>([]);
  const [config, setConfig] = useState<PublicConfig>(() => envConfig());
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confetti, setConfetti] = useState<Confetti | null>(null);

  const bootstrapped = useRef(false);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = nextId();
    setToasts((prev) => [...prev.slice(-2), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const spawnReward = useCallback((coins: number, usdt: number) => {
    if (coins <= 0 && usdt <= 0) return;
    const id = nextId();
    setFloaters((prev) => [...prev.slice(-4), { id, coins, usdt }]);
    window.setTimeout(() => {
      setFloaters((prev) => prev.filter((f) => f.id !== id));
    }, 1600);
  }, []);

  const celebrate = useCallback(() => {
    const pieces: ConfettiPiece[] = Array.from({ length: 46 }).map((_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 320,
      y: 220 + Math.random() * 320,
      r: (Math.random() - 0.5) * 720,
      delay: Math.random() * 0.12,
      size: 6 + Math.random() * 8,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    }));
    setConfetti({ key: Date.now(), pieces });
  }, []);

  const dismissFloater = useCallback((id: string) => {
    setFloaters((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // --- Bootstrap: auth + initial data -------------------------------------
  const refresh = useCallback(async () => {
    const [t, lb, tk, me] = await Promise.all([
      fetchTasks(),
      fetchLeaderboard(10),
      fetchTicker(12),
      fetchMe(),
    ]);
    setTasks(t);
    setLeaderboard(lb);
    setTicker(tk);

    if (me) {
      if (me.profile) setProfile(me.profile);
      if (me.wallet) setWallet(me.wallet);
      const map: Record<string, UserTask> = {};
      me.userTasks.forEach((row) => (map[row.task_id] = row));
      setUserTasks(map);
      setActivity(me.activity);
      setCheckins(me.checkins);
      setConnectedAccounts(me.connectedAccounts);
    }
  }, []);

  useEffect(() => {
    if (!isReady || bootstrapped.current) return;
    bootstrapped.current = true;

    const run = async () => {
      try {
        // Kick off the (independent) runtime-config fetch in parallel with auth
        // so first paint is not serialised behind an extra round-trip.
        const configPromise = fetchRuntimeConfig();

        const res = await fetch("/api/telegram-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            initData,
            referralCode: referralCode ?? undefined,
          }),
        });
        const json = (await res.json()) as AuthResponse;
        if (!json.ok || !json.profile) throw new Error(json.error ?? "auth_failed");

        setSessionToken(json.token ?? null);
        setInitData(initData || null);

        // Render the shell as soon as identity is known — the rest streams in.
        setProfile(json.profile);
        setWallet(json.wallet ?? null);

        const [t, lb, tk, cfg, me] = await Promise.all([
          fetchTasks(),
          fetchLeaderboard(10),
          fetchTicker(12),
          configPromise,
          fetchMe(),
        ]);

        const map: Record<string, UserTask> = {};
        (me?.userTasks ?? []).forEach((row) => (map[row.task_id] = row));

        setTasks(t);
        setUserTasks(map);
        setLeaderboard(lb);
        setTicker(tk);
        setActivity(me?.activity ?? []);
        setCheckins(me?.checkins ?? []);
        setConnectedAccounts(me?.connectedAccounts ?? []);
        setConfig(cfg);
        if (me?.profile) setProfile(me.profile);
        if (me?.wallet) setWallet(me.wallet);
        setStatus("ready");
      } catch (err) {
        console.error("[questify] bootstrap failed", err);
        setStatus("error");
        pushToast({ kind: "error", title: "Connection issue", message: "Retrying in offline mode" });
      }
    };

    void run();
  }, [isReady, initData, referralCode, pushToast]);

  const checkin = useMemo(() => deriveCheckin(checkins), [checkins]);
  const completedCount = useMemo(
    () => Object.values(userTasks).filter((t) => t.status === "completed").length,
    [userTasks],
  );

  // Derived leaderboard with the current user injected
  const leaderboardWithMe = useMemo(() => {
    if (!profile) return leaderboard;
    const has = leaderboard.some((e) => e.id === profile.id);
    if (has) {
      return leaderboard.map((e) =>
        e.id === profile.id ? { ...e, is_me: true, usdt_earned: profile.usdt_balance } : e,
      );
    }
    const mine: LeaderboardEntry = {
      id: profile.id,
      username: profile.username ?? "you",
      photo_url: profile.photo_url,
      level: profile.level,
      usdt_earned: profile.usdt_balance,
      referrals: profile.referral_count,
      rank: 42,
      is_me: true,
    };
    return [...leaderboard, mine].sort((a, b) => b.usdt_earned - a.usdt_earned).map((e, i) => ({
      ...e,
      rank: i + 1,
    }));
  }, [leaderboard, profile]);

  const applyProfileDelta = useCallback((coins: number, usdt: number, trust = 0) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const nextCoins = prev.coins + coins;
      const nextLevel = Math.max(1, Math.floor(nextCoins / 1000) + 1);
      if (nextLevel > prev.level) {
        celebrate();
        window.setTimeout(
          () => pushToast({ kind: "success", title: `Level up! Lv.${nextLevel}`, message: "New rewards unlocked" }),
          200,
        );
      }
      return {
        ...prev,
        coins: nextCoins,
        usdt_balance: Number((prev.usdt_balance + usdt).toFixed(6)),
        trust_score: Math.min(100, prev.trust_score + trust),
        level: nextLevel,
      };
    });
  }, [celebrate, pushToast]);

  // --- Actions -------------------------------------------------------------
  // Records the server-side "started" marker so the duration gate in
  // `claim_task` can be enforced on the database clock (client timer is UX only).
  const startTask = useCallback<QuestifyContextValue["actions"]["startTask"]>(
    async (task) => {
      if (!profile) return { ok: false, message: "Not signed in" };
      if (!isSupabaseConfigured) return { ok: true };
      try {
        await rpcStartTask(task.id);
        return { ok: true };
      } catch (err) {
        return { ok: false, message: errorText(err) };
      }
    },
    [profile],
  );

  const completeTask = useCallback<QuestifyContextValue["actions"]["completeTask"]>(
    async (task) => {
      if (!profile) return { ok: false, message: "Not signed in" };
      if (userTasks[task.id]?.status === "completed") {
        return { ok: false, message: "Already completed" };
      }

      if (isSupabaseConfigured) {
        let res: ClaimResult;
        try {
          res = await rpcClaimTask(task.id);
        } catch (err) {
          return { ok: false, message: errorText(err) };
        }
        if (!res || typeof res.coins !== "number") {
          return { ok: false, message: "Reward service unavailable, please try again" };
        }
        applyProfileDelta(res.coins, res.usdt ?? 0, 1);
        if (res.profile) setProfile(res.profile);
        spawnReward(res.coins, res.usdt ?? 0);
        haptic("medium");
      } else {
        applyProfileDelta(task.reward_coins, task.reward_usdt, 1);
        spawnReward(task.reward_coins, task.reward_usdt);
        haptic("medium");
      }

      const now = new Date().toISOString();
      const record: UserTask = {
        id: `local-${task.id}`,
        user_id: profile.id,
        task_id: task.id,
        status: "completed",
        reward_coins: task.reward_coins,
        reward_usdt: task.reward_usdt,
        submitted_at: now,
        completed_at: now,
        created_at: now,
      };
      setUserTasks((prev) => ({ ...prev, [task.id]: record }));
      setActivity((prev) => [
        {
          id: nextId(),
          type: "reward",
          title: `Task reward · ${task.title}`,
          subtitle: "Task completed",
          amount_coins: task.reward_coins,
          amount_usdt: task.reward_usdt,
          status: "completed",
          created_at: now,
        },
        ...prev,
      ]);
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, completions: t.completions + 1 } : t)),
      );

      return {
        ok: true,
        coins: task.reward_coins,
        usdt: task.reward_usdt,
        message: "Reward credited",
      };
    },
    [profile, userTasks, applyProfileDelta, spawnReward, haptic],
  );

  const claimCheckin = useCallback(async () => {
    if (!profile) return { ok: false, message: "Not signed in" };
    if (checkin.hasToday) return { ok: false, message: "Already claimed today" };

    let rewardCoins: number = checkin.reward;
    const day = checkin.nextDay;

    if (isSupabaseConfigured) {
      let res: ClaimResult;
      try {
        res = await rpcClaimCheckin();
      } catch (err) {
        return { ok: false, message: errorText(err) };
      }
      if (!res || typeof res.coins !== "number") {
        return { ok: false, message: "Check-in service unavailable, please try again" };
      }
      rewardCoins = res.coins;
      if (res.profile) setProfile(res.profile);
    }

    applyProfileDelta(rewardCoins, 0, 2);
    spawnReward(rewardCoins, 0);
    haptic("heavy");

    const now = new Date().toISOString();
    const record: DailyCheckin = {
      id: nextId(),
      user_id: profile.id,
      day_index: day,
      reward_coins: rewardCoins,
      checked_in_at: now,
      streak_date: now.slice(0, 10),
    };
    setCheckins((prev) => [record, ...prev]);
    setActivity((prev) => [
      {
        id: nextId(),
        type: "checkin",
        title: `Daily check-in · Day ${day}`,
        subtitle: `Streak bonus x${(CHECKIN_SCHEDULE[day - 1]?.multiplier ?? 1).toFixed(1)}`,
        amount_coins: rewardCoins,
        amount_usdt: 0,
        status: "completed",
        created_at: now,
      },
      ...prev,
    ]);

    return { ok: true, coins: rewardCoins, message: `+${rewardCoins} coins` };
  }, [profile, checkin, applyProfileDelta, spawnReward, haptic]);

  const requestWithdrawal = useCallback<
    QuestifyContextValue["actions"]["requestWithdrawal"]
  >(
    async (amount, network, address) => {
      if (!profile) return { ok: false, message: "Not signed in" };
      if (amount < config.minWithdrawalUsdt)
        return { ok: false, message: `Minimum withdrawal is ${config.minWithdrawalUsdt} USDT` };
      if (amount > profile.usdt_balance)
        return { ok: false, message: "Insufficient balance" };
      if (profile.trust_score < 30)
        return { ok: false, message: "Trust score too low" };
      if (!address || address.trim().length < 10)
        return { ok: false, message: `Enter a valid ${network} address` };

      if (isSupabaseConfigured) {
        try {
          await rpcWithdraw(amount, network, address);
        } catch (err) {
          return { ok: false, message: errorText(err) };
        }
      }

      setProfile((prev) =>
        prev
          ? { ...prev, usdt_balance: Number((prev.usdt_balance - amount).toFixed(6)) }
          : prev,
      );
      setWallet((prev) => {
        if (!prev) return prev;
        return network === "BEP20"
          ? { ...prev, usdt_bep20: address }
          : { ...prev, ton_address: address };
      });

      const now = new Date().toISOString();
      setActivity((prev) => [
        {
          id: nextId(),
          type: "withdrawal",
          title: `Withdrawal to ${network}`,
          subtitle: `${address.slice(0, 4)}...${address.slice(-4)} · Pending`,
          amount_coins: 0,
          amount_usdt: -amount,
          status: "pending",
          created_at: now,
        },
        ...prev,
      ]);
      setTicker((prev) => [
        {
          id: nextId(),
          masked_name: `${(profile.username ?? "you").slice(0, 1)}***${(profile.username ?? "u").slice(-1)}`,
          amount_usdt: amount,
          network,
          created_at: now,
        },
        ...prev.slice(0, 11),
      ]);
      haptic("heavy");
      notifyRewardToast(amount, network, pushToast);

      return { ok: true, usdt: amount, message: "Withdrawal submitted" };
    },
    [profile, config.minWithdrawalUsdt, haptic, pushToast],
  );

  const updateWallet = useCallback(
    async (patch: Partial<Wallet>) => {
      if (!profile) return { ok: false, message: "Not signed in" };
      if (isSupabaseConfigured) {
        try {
          await saveWallet(patch);
        } catch (err) {
          return { ok: false, message: errorText(err) };
        }
      }
      setWallet((prev) => (prev ? { ...prev, ...patch } : prev));
      return { ok: true, message: "Wallet saved" };
    },
    [profile],
  );

  const applyReferral = useCallback(
    (code: string) => {
      if (!code) return;
      pushToast({ kind: "success", title: "Referral applied", message: `Code ${code}` });
    },
    [pushToast],
  );

  const linkAccount = useCallback<
    QuestifyContextValue["actions"]["linkAccount"]
  >(
    async (provider, payload) => {
      try {
        const res = await fetch("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ provider, ...payload }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error || "link_failed");
        await refresh();
        pushToast({ kind: "success", title: "Account linked", message: provider });
        return { ok: true };
      } catch (err) {
        return { ok: false, message: errorText(err) };
      }
    },
    [pushToast, refresh],
  );

  const value = useMemo<QuestifyContextValue>(
    () => ({
      status,
      isInTelegram,
      isLive: isSupabaseConfigured,
      profile,
      wallet,
      tasks,
      userTasks,
      leaderboard: leaderboardWithMe,
      ticker,
      activity,
      checkins,
      checkin,
      totalTasks: tasks.length,
      completedCount,
      floaters,
      toasts,
      confetti,
      config,
      connectedAccounts,
      actions: {
        startTask,
        completeTask,
        claimCheckin,
        requestWithdrawal,
        updateWallet,
        applyReferral,
        linkAccount,
        dismissFloater,
        dismissToast,
        pushToast,
        refresh,
      },
    }),
    [
      status,
      isInTelegram,
      profile,
      wallet,
      tasks,
      userTasks,
      leaderboardWithMe,
      ticker,
      activity,
      checkins,
      checkin,
      completedCount,
      floaters,
      toasts,
      confetti,
      config,
      connectedAccounts,
      startTask,
      completeTask,
      claimCheckin,
      requestWithdrawal,
      updateWallet,
      applyReferral,
      linkAccount,
      dismissFloater,
      dismissToast,
      pushToast,
      refresh,
    ],
  );

  // keep tgUser referenced for future personalization without lint noise
  void tgUser;

  return <QuestifyContext.Provider value={value}>{children}</QuestifyContext.Provider>;
}

function notifyRewardToast(
  amount: number,
  network: Withdrawal["network"],
  push: (t: Omit<Toast, "id">) => void,
) {
  push({
    kind: "success",
    title: "Withdrawal submitted",
    message: `${amount.toFixed(2)} USDT · ${network}`,
    amountUsdt: amount,
  });
}

export function useQuestify(): QuestifyContextValue {
  const ctx = useContext(QuestifyContext);
  if (!ctx) throw new Error("useQuestify must be used within <QuestifyProvider>");
  return ctx;
}
