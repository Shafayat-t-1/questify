import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side task verification.
 *
 * Runs inside the authenticated `/api/rewards` handler (the only caller of the
 * reward RPCs) and decides whether a user genuinely completed a task BEFORE any
 * reward is credited. The client is never trusted: the countdown timer is UX,
 * while these checks — plus the duration gate inside `claim_task` — are the
 * authority.
 *
 * Verification is configured per task by an admin:
 *   verification_type    verification_target
 *   -----------------    -------------------
 *   none | timer         (ignored)                → time gate only
 *   telegram_join        @channel or -100…chat id → Bot API getChatMember
 *   account_link | x |   provider (x/google/…)    → connected_accounts row
 *   youtube | discord |
 *   google | github |
 *   reddit | tiktok
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export interface VerifiableTask {
  id: string;
  platform: string;
  verification_type?: string | null;
  verification_target?: string | null;
  verification_rules?: Record<string, unknown> | null;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/** Aliases so admins can set either a provider name or the verification type. */
const PROVIDER_ALIASES: Record<string, string> = {
  twitter: "x",
  x: "x",
  google: "google",
  youtube: "youtube",
  discord: "discord",
  github: "github",
  reddit: "reddit",
  tiktok: "tiktok",
  telegram: "telegram",
};

const TELEGRAM_TYPES = new Set([
  "telegram",
  "telegram_join",
  "telegram_channel",
  "telegram_member",
  "telegram_subscribe",
]);

const ACCOUNT_TYPES = new Set(["account_link", "social", "link", "account"]);

async function verifyTelegramMembership(chat: string, userId: number): Promise<VerifyResult> {
  if (!BOT_TOKEN) return { ok: true };
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(
      chat,
    )}&user_id=${userId}`;
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json()) as {
      ok?: boolean;
      result?: { status?: string; is_member?: boolean };
    };
    if (!json.ok) return { ok: false, reason: "not_member" };
    const status = json.result?.status ?? "";
    if (status === "creator" || status === "administrator" || status === "member") {
      return { ok: true };
    }
    if (status === "restricted" && json.result?.is_member) return { ok: true };
    return { ok: false, reason: "not_member" };
  } catch {
    return { ok: false, reason: "verification_error" };
  }
}

/**
 * Verify a task for a user. Returns `{ ok: true }` when the requirement is met,
 * otherwise a machine-readable `reason` the API/client can translate.
 */
export async function verifyTask(params: {
  task: VerifiableTask;
  userId: string;
  telegramId: number | null;
  admin: SupabaseClient;
}): Promise<VerifyResult> {
  const { task, userId, telegramId, admin } = params;
  const type = (task.verification_type ?? "").trim().toLowerCase();

  // Nothing to verify beyond the server-side duration gate.
  if (!type || type === "none" || type === "timer") return { ok: true };

  if (TELEGRAM_TYPES.has(type)) {
    // Without a bot token we cannot call the Bot API (local/dev) — don't block.
    if (!BOT_TOKEN) return { ok: true };
    const chat = (task.verification_target ?? "").trim();
    if (!chat) return { ok: false, reason: "task_misconfigured" };
    if (!telegramId) return { ok: false, reason: "telegram_not_configured" };
    return verifyTelegramMembership(chat, telegramId);
  }

  if (ACCOUNT_TYPES.has(type) || type in PROVIDER_ALIASES) {
    const raw = (task.verification_target ?? type).trim().toLowerCase();
    const provider = PROVIDER_ALIASES[raw] ?? raw;
    const { data, error } = await admin
      .from("connected_accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) return { ok: false, reason: "verification_error" };
    return data ? { ok: true } : { ok: false, reason: "account_not_linked" };
  }

  // Unknown verification type: fail closed rather than silently paying out.
  return { ok: false, reason: "unsupported_verification" };
}
