/**
 * Referral orchestration (server-side, dependency-injected, unit-testable).
 *
 * Every profile-creation login goes through `processReferral`. It resolves the
 * referral source in trust order, applies the eligibility rule, calls the
 * authoritative `apply_referral` RPC and records a `referral_events` row so the
 * outcome is always auditable — even when no code is present.
 *
 * Storage is behind the {@link ReferralRepo} seam: the Next.js route supplies a
 * Supabase/service-role adapter, tests supply an in-memory fake. This module is
 * pure logic and safe to import from anywhere.
 */

import { parseReferralCode } from "./referral";

export type ReferralSource = "init_data" | "client_param" | "pending" | "none";
export type ReferralOutcome = "applied" | "skipped" | "error";

/** A single audit row (never contains tokens or raw initData). */
export interface ReferralEventRecord {
  telegramId: number | null;
  source: ReferralSource;
  codeRaw: string | null;
  outcome: ReferralOutcome;
  reason: string | null;
}

/** Snapshot of the target account used to decide eligibility. */
export interface ReferralEligibility {
  referredBy: string | null;
  referralConsumed: boolean;
  accountCreatedAt: string;
  completedTasks: number;
  withdrawals: number;
}

/** Storage seam. All methods are best-effort at the call site, not here. */
export interface ReferralRepo {
  getEligibility(userId: string): Promise<ReferralEligibility | null>;
  findReferrerIdByCode(code: string): Promise<string | null>;
  /** Calls the idempotent `apply_referral` RPC. Returns true only if linked. */
  applyReferral(userId: string, code: string): Promise<boolean>;
  /** Atomically claims an unconsumed pending referral (7-day TTL, once). */
  claimPendingReferral(telegramId: number): Promise<string | null>;
  logEvent(event: ReferralEventRecord): Promise<void>;
}

export interface ProcessReferralInput {
  userId: string;
  telegramId: number;
  isNewProfile: boolean;
  /** HMAC-verified `initData.start_param` (most trusted). */
  initDataStartParam: string | null;
  /** Client-sent code (`tgWebAppStartParam` then `?ref=`, resolved client-side). */
  clientParam: string | null;
}

export interface ProcessReferralResult {
  source: ReferralSource;
  codeRaw: string | null;
  outcome: ReferralOutcome;
  reason: string | null;
}

const ACCOUNT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Eligibility rule (replaces the old "the profile was just created" gate):
 *   referred_by is null AND no referral already consumed AND account < 24h old
 *   AND zero completed tasks AND zero withdrawals.
 */
export function evaluateEligibility(
  eligibility: ReferralEligibility,
  now: number = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  if (eligibility.referredBy !== null) return { ok: false, reason: "already_referred" };
  if (eligibility.referralConsumed) return { ok: false, reason: "referral_already_consumed" };

  const created = new Date(eligibility.accountCreatedAt).getTime();
  if (!Number.isFinite(created) || now - created >= ACCOUNT_MAX_AGE_MS) {
    return { ok: false, reason: "account_too_old" };
  }
  if (eligibility.completedTasks > 0) return { ok: false, reason: "account_has_task_activity" };
  if (eligibility.withdrawals > 0) return { ok: false, reason: "account_has_withdrawals" };
  return { ok: true };
}

async function log(
  repo: ReferralRepo,
  event: ReferralEventRecord,
): Promise<void> {
  try {
    await repo.logEvent(event);
  } catch (err) {
    // Evidence is important but must never break a login.
    console.error("[questify] referral_events write failed", err);
  }
}

/**
 * Resolve the referral source and apply it. Never throws: every failure is
 * logged to `referral_events` and returned as a typed result.
 */
export async function processReferral(
  repo: ReferralRepo,
  input: ProcessReferralInput,
): Promise<ProcessReferralResult> {
  const { userId, telegramId, isNewProfile } = input;

  // --- 1. Resolve the code, in trust order -------------------------------
  let source: ReferralSource = "none";
  let codeRaw: string | null = null;

  const fromInit = nonEmpty(input.initDataStartParam);
  const fromClient = nonEmpty(input.clientParam);

  if (fromInit) {
    source = "init_data";
    codeRaw = fromInit;
  } else if (fromClient) {
    source = "client_param";
    codeRaw = fromClient;
  } else {
    let pending: string | null = null;
    try {
      pending = await repo.claimPendingReferral(telegramId);
    } catch (err) {
      console.error("[questify] pending referral lookup failed", err);
    }
    if (pending) {
      source = "pending";
      codeRaw = pending;
    }
  }

  // No code and not a new profile: nothing to record.
  if (!codeRaw && !isNewProfile) {
    return { source, codeRaw: null, outcome: "skipped", reason: "not_new_profile" };
  }

  if (!codeRaw) {
    await log(repo, { telegramId, source: "none", codeRaw: null, outcome: "skipped", reason: "no_code" });
    return { source: "none", codeRaw: null, outcome: "skipped", reason: "no_code" };
  }

  const parsed = parseReferralCode(codeRaw);
  if (!parsed) {
    await log(repo, { telegramId, source, codeRaw, outcome: "skipped", reason: "invalid_code" });
    return { source, codeRaw, outcome: "skipped", reason: "invalid_code" };
  }

  // --- 2. Eligibility gate ----------------------------------------------
  let eligibility: ReferralEligibility | null = null;
  try {
    eligibility = await repo.getEligibility(userId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "eligibility_lookup_failed";
    console.error("[questify] referral eligibility lookup failed", err);
    await log(repo, { telegramId, source, codeRaw, outcome: "error", reason });
    return { source, codeRaw, outcome: "error", reason };
  }

  if (!eligibility) {
    await log(repo, {
      telegramId,
      source,
      codeRaw,
      outcome: "skipped",
      reason: "profile_missing",
    });
    return { source, codeRaw, outcome: "skipped", reason: "profile_missing" };
  }

  const gate = evaluateEligibility(eligibility);
  if (!gate.ok) {
    await log(repo, { telegramId, source, codeRaw, outcome: "skipped", reason: gate.reason });
    return { source, codeRaw, outcome: "skipped", reason: gate.reason };
  }

  // --- 3. Resolve the referrer (reject unknown + self) -------------------
  let referrerId: string | null = null;
  try {
    referrerId = await repo.findReferrerIdByCode(parsed.code);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "referrer_lookup_failed";
    console.error("[questify] referrer lookup failed", err);
    await log(repo, { telegramId, source, codeRaw, outcome: "error", reason });
    return { source, codeRaw, outcome: "error", reason };
  }

  if (!referrerId) {
    await log(repo, { telegramId, source, codeRaw, outcome: "skipped", reason: "unknown_code" });
    return { source, codeRaw, outcome: "skipped", reason: "unknown_code" };
  }
  if (referrerId === userId) {
    await log(repo, { telegramId, source, codeRaw, outcome: "skipped", reason: "self_referral" });
    return { source, codeRaw, outcome: "skipped", reason: "self_referral" };
  }

  // --- 4. Apply (idempotent, authoritative) ------------------------------
  let applied = false;
  try {
    applied = await repo.applyReferral(userId, parsed.code);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "apply_failed";
    console.error("[questify] apply_referral failed", err);
    await log(repo, { telegramId, source, codeRaw, outcome: "error", reason });
    return { source, codeRaw, outcome: "error", reason };
  }

  const outcome: ReferralOutcome = applied ? "applied" : "skipped";
  const reason = applied ? null : "rpc_rejected";
  await log(repo, { telegramId, source, codeRaw, outcome, reason });
  return { source, codeRaw, outcome, reason };
}
