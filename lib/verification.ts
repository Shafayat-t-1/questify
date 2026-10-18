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
 *   none | timer | ""    (ignored)                → time gate only
 *   telegram_join        @channel or -100…chat id → Bot API getChatMember
 *   telegram_boost       @channel or -100…chat id → Bot API getUserChatBoosts
 *   github_star          owner/repo               → GitHub API (linked account)
 *   github_fork          owner/repo               → GitHub API (linked account)
 *   account_link | x |   provider (x/google/…)    → connected_accounts row
 *   youtube | discord |
 *   google | github |
 *   reddit | tiktok
 *
 * HONESTY RULES (phase 4A):
 *   - A task WITH a verification_type never silently falls back to timer-only.
 *     If the check cannot run (no bot token, provider outage, rate limit) the
 *     claim is REJECTED with a clear reason instead of being paid out.
 *   - telegram_* requires TELEGRAM_BOT_TOKEN; github_* requires a linked
 *     GitHub account and a reachable GitHub API. No linked account → the user
 *     is told to link one first ("github_not_linked"), never "you didn't star".
 */

const EXTERNAL_TIMEOUT_MS = 8000;

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

const GITHUB_ACTION_TYPES = new Set(["github_star", "github_fork"]);

const ACCOUNT_TYPES = new Set(["account_link", "social", "link", "account"]);

/** Read at call time (not module load) so tests and boot order can set it. */
function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

async function telegramApi(
  method: string,
  chat: string,
  userId: number,
): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false }> {
  const token = botToken();
  if (!token) return { ok: false };
  try {
    const url = `https://api.telegram.org/bot${token}/${method}?chat_id=${encodeURIComponent(
      chat,
    )}&user_id=${userId}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) });
    const json = (await res.json()) as {
      ok?: boolean;
      result?: Record<string, unknown>;
    };
    if (!json.ok) return { ok: false };
    return { ok: true, result: json.result ?? {} };
  } catch {
    return { ok: false };
  }
}

async function verifyTelegramMembership(chat: string, userId: number): Promise<VerifyResult> {
  const res = await telegramApi("getChatMember", chat, userId);
  if (!res.ok) return { ok: false, reason: "verification_error" };
  const status = typeof res.result.status === "string" ? res.result.status : "";
  if (status === "creator" || status === "administrator" || status === "member") {
    return { ok: true };
  }
  if (status === "restricted" && res.result.is_member === true) return { ok: true };
  return { ok: false, reason: "not_member" };
}

/**
 * telegram_boost: the Bot API CAN confirm boosts — `getUserChatBoosts`
 * (requires the bot to be an ADMIN of the target chat) returns the boosts a
 * user has applied; a boost is active while its `expiration_date` is in the
 * future.
 */
async function verifyTelegramBoost(chat: string, userId: number): Promise<VerifyResult> {
  const res = await telegramApi("getUserChatBoosts", chat, userId);
  if (!res.ok) return { ok: false, reason: "verification_error" };
  const boosts = Array.isArray(res.result.boosts)
    ? (res.result.boosts as Array<{ expiration_date?: number }>)
    : [];
  const now = Math.floor(Date.now() / 1000);
  const active = boosts.some(
    (b) => typeof b.expiration_date !== "number" || b.expiration_date > now,
  );
  return active ? { ok: true } : { ok: false, reason: "not_boosted" };
}

// ---------------------------------------------------------------------------
// GitHub star / fork verification
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";
/**
 * Pagination cap per check. A task targets a FRESH star/fork, and both list
 * endpoints are sorted newest-first, so the match is on page 1 in practice;
 * the cap only bounds a pathological case. If the list is longer than the cap
 * and no match was found, the result is `verification_inconclusive` (fail
 * closed) — never a false "you didn't do it".
 */
const GITHUB_MAX_PAGES = 10;
const GITHUB_PER_PAGE = 100;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
  };
  // Optional server-side token: unauthenticated GitHub API = 60 requests/hour
  // per IP; authenticated (classic/fine-grained PAT) = 5,000/hour. With a
  // token set, every check below uses it.
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Parse `owner/repo` (or a github.com URL) from verification_target. */
export function parseGitHubRepoTarget(
  target: string | null | undefined,
): { owner: string; repo: string } | null {
  const cleaned = (target ?? "")
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!/^[\w.-]{1,100}$/.test(owner) || !/^[\w.-]{1,100}$/.test(repo)) return null;
  return { owner, repo };
}

interface ScanResult {
  found: boolean;
  /** True when the list ended before the page cap (definitive negative). */
  exhausted: boolean;
  /** True when the API itself could not be consulted (403/429/5xx/network). */
  error: boolean;
  /** True when the target resource does not exist (bad task config). */
  notFound: boolean;
}

async function scanGitHubList(
  pageUrl: (page: number) => string,
  matches: (item: Record<string, unknown>) => boolean,
): Promise<ScanResult> {
  for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
    let res: Response;
    try {
      res = await fetch(pageUrl(page), {
        headers: githubHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
      });
    } catch {
      return { found: false, exhausted: false, error: true, notFound: false };
    }
    if (res.status === 404) return { found: false, exhausted: false, error: false, notFound: true };
    if (!res.ok) return { found: false, exhausted: false, error: true, notFound: false };

    let items: unknown;
    try {
      items = await res.json();
    } catch {
      return { found: false, exhausted: false, error: true, notFound: false };
    }
    if (!Array.isArray(items)) {
      return { found: false, exhausted: false, error: true, notFound: false };
    }
    if (items.some((item) => item && typeof item === "object" && matches(item as Record<string, unknown>))) {
      return { found: true, exhausted: false, error: false, notFound: false };
    }
    // A short or empty page is the end of the list → definitive negative.
    if (items.length < GITHUB_PER_PAGE) {
      return { found: false, exhausted: true, error: false, notFound: false };
    }
  }
  return { found: false, exhausted: false, error: false, notFound: false };
}

async function verifyGitHubAction(
  admin: SupabaseClient,
  userId: string,
  kind: "github_star" | "github_fork",
  target: string | null | undefined,
): Promise<VerifyResult> {
  const { data, error } = await admin
    .from("connected_accounts")
    .select("username")
    .eq("user_id", userId)
    .eq("provider", "github")
    .maybeSingle();
  if (error) return { ok: false, reason: "verification_error" };
  const username = (data as { username?: string | null } | null)?.username?.trim();
  if (!username) return { ok: false, reason: "github_not_linked" };

  const repo = parseGitHubRepoTarget(target);
  if (!repo) return { ok: false, reason: "task_misconfigured" };

  let scan: ScanResult;
  if (kind === "github_star") {
    // The per-user starred list (public) is used instead of the repo's
    // stargazer list: since July 2026 GitHub restricts the repo stargazers
    // endpoints to that repo's admins/collaborators. Sort=created&direction=desc
    // puts a star made for this task on page 1.
    scan = await scanGitHubList(
      (page) =>
        `${GITHUB_API}/users/${encodeURIComponent(username)}/starred?sort=created&direction=desc&per_page=${GITHUB_PER_PAGE}&page=${page}`,
      (item) =>
        typeof item.full_name === "string" &&
        item.full_name.toLowerCase() === `${repo.owner}/${repo.repo}`.toLowerCase(),
    );
  } else {
    scan = await scanGitHubList(
      (page) =>
        `${GITHUB_API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
          repo.repo,
        )}/forks?sort=newest&per_page=${GITHUB_PER_PAGE}&page=${page}`,
      (item) => {
        const owner = item.owner;
        return (
          !!owner &&
          typeof owner === "object" &&
          typeof (owner as Record<string, unknown>).login === "string" &&
          ((owner as Record<string, unknown>).login as string).toLowerCase() ===
            username.toLowerCase()
        );
      },
    );
  }

  if (scan.found) return { ok: true };
  if (scan.notFound) {
    return kind === "github_star"
      ? { ok: false, reason: "verification_error" }
      : { ok: false, reason: "task_misconfigured" };
  }
  if (scan.error) return { ok: false, reason: "verification_error" };
  if (scan.exhausted) {
    return { ok: false, reason: kind === "github_star" ? "not_starred" : "not_forked" };
  }
  // Hit the page cap without a match and without seeing the end of the list:
  // we genuinely do not know — fail closed, honestly.
  return { ok: false, reason: "verification_inconclusive" };
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

  if (type === "telegram_boost") {
    const chat = (task.verification_target ?? "").trim();
    if (!chat) return { ok: false, reason: "task_misconfigured" };
    if (!botToken()) return { ok: false, reason: "verification_unavailable" };
    if (!telegramId) return { ok: false, reason: "telegram_not_configured" };
    return verifyTelegramBoost(chat, telegramId);
  }

  if (TELEGRAM_TYPES.has(type)) {
    const chat = (task.verification_target ?? "").trim();
    if (!chat) return { ok: false, reason: "task_misconfigured" };
    // No bot token → the check CANNOT run. Fail closed with a clear reason
    // instead of silently downgrading to timer-only (phase 4A honesty rule).
    if (!botToken()) return { ok: false, reason: "verification_unavailable" };
    if (!telegramId) return { ok: false, reason: "telegram_not_configured" };
    return verifyTelegramMembership(chat, telegramId);
  }

  if (GITHUB_ACTION_TYPES.has(type)) {
    return verifyGitHubAction(admin, userId, type as "github_star" | "github_fork", task.verification_target);
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
