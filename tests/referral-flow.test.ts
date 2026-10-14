import { describe, expect, it } from "vitest";
import {
  processReferral,
  type ReferralEligibility,
  type ReferralEventRecord,
  type ReferralRepo,
} from "@/lib/referral-server";
import { verifyTelegramInitData } from "@/lib/telegram-auth";
import { signInitData, TEST_BOT_TOKEN } from "./telegram-fixture";

interface FakeProfile {
  id: string;
  referredBy: string | null;
  referralCode: string;
  accountCreatedAt: string;
  completedTasks: number;
  withdrawals: number;
  referralConsumed: boolean;
}

/** In-memory implementation of the storage seam, mirroring the SQL gate. */
class FakeRepo implements ReferralRepo {
  profiles = new Map<string, FakeProfile>();
  referrersByCode = new Map<string, string>();
  pending = new Map<number, { code: string; consumed: boolean }>();
  events: ReferralEventRecord[] = [];

  addProfile(id: string, opts: Partial<FakeProfile> = {}): FakeProfile {
    const profile: FakeProfile = {
      id,
      referredBy: opts.referredBy ?? null,
      referralCode: opts.referralCode ?? "",
      accountCreatedAt: opts.accountCreatedAt ?? new Date().toISOString(),
      completedTasks: opts.completedTasks ?? 0,
      withdrawals: opts.withdrawals ?? 0,
      referralConsumed: opts.referralConsumed ?? false,
    };
    this.profiles.set(id, profile);
    if (profile.referralCode) this.referrersByCode.set(profile.referralCode, id);
    return profile;
  }

  async getEligibility(userId: string): Promise<ReferralEligibility | null> {
    const p = this.profiles.get(userId);
    if (!p) return null;
    return {
      referredBy: p.referredBy,
      referralConsumed: p.referralConsumed,
      accountCreatedAt: p.accountCreatedAt,
      completedTasks: p.completedTasks,
      withdrawals: p.withdrawals,
    };
  }

  async findReferrerIdByCode(code: string): Promise<string | null> {
    return this.referrersByCode.get(code) ?? null;
  }

  async applyReferral(userId: string, code: string): Promise<boolean> {
    const target = this.profiles.get(userId);
    const referrerId = this.referrersByCode.get(code);
    if (!target || !referrerId || referrerId === userId) return false;
    if (target.referredBy !== null || target.referralConsumed) return false;
    target.referredBy = referrerId;
    target.referralConsumed = true;
    return true;
  }

  async claimPendingReferral(telegramId: number): Promise<string | null> {
    const row = this.pending.get(telegramId);
    if (!row || row.consumed) return null;
    row.consumed = true;
    return row.code;
  }

  async logEvent(event: ReferralEventRecord): Promise<void> {
    this.events.push(event);
  }
}

const REF_CODE = "0CC06D6D";

function newRepo(withReferrer = true): FakeRepo {
  const repo = new FakeRepo();
  if (withReferrer) repo.addProfile("referrer", { referralCode: REF_CODE });
  repo.addProfile("newbie");
  return repo;
}

describe("processReferral", () => {
  it("(1) applies a start_param delivered in HMAC-signed initData", async () => {
    const repo = newRepo();
    const initData = signInitData(
      { user: { id: 999, first_name: "New" }, start_param: REF_CODE },
      TEST_BOT_TOKEN,
    );
    const verified = verifyTelegramInitData(initData, TEST_BOT_TOKEN);
    expect(verified?.startParam).toBe(REF_CODE);

    const result = await processReferral(repo, {
      userId: "newbie",
      telegramId: 999,
      isNewProfile: true,
      initDataStartParam: verified!.startParam,
      clientParam: null,
    });

    expect(result).toMatchObject({ source: "init_data", outcome: "applied" });
    expect(repo.profiles.get("newbie")?.referredBy).toBe("referrer");
  });

  it("(2) falls back to an unconsumed pending_referrals row", async () => {
    const repo = newRepo();
    repo.pending.set(999, { code: REF_CODE, consumed: false });
    const initData = signInitData({ user: { id: 999, first_name: "New" } }, TEST_BOT_TOKEN);
    const verified = verifyTelegramInitData(initData, TEST_BOT_TOKEN);
    expect(verified?.startParam).toBeNull();

    const result = await processReferral(repo, {
      userId: "newbie",
      telegramId: 999,
      isNewProfile: true,
      initDataStartParam: verified!.startParam,
      clientParam: null,
    });

    expect(result).toMatchObject({ source: "pending", outcome: "applied" });
    expect(repo.pending.get(999)?.consumed).toBe(true);
  });

  it("(3) applies a client-only param and prefers initData when both exist", async () => {
    const repo = newRepo();
    const clientOnly = await processReferral(repo, {
      userId: "newbie",
      telegramId: 999,
      isNewProfile: true,
      initDataStartParam: null,
      clientParam: REF_CODE,
    });
    expect(clientOnly).toMatchObject({ source: "client_param", outcome: "applied" });

    const repo2 = newRepo();
    const both = await processReferral(repo2, {
      userId: "newbie",
      telegramId: 999,
      isNewProfile: true,
      initDataStartParam: REF_CODE,
      clientParam: "SOMETHINGELSE",
    });
    expect(both.source).toBe("init_data");
  });

  it("(4) skips an unknown code and records the attempt", async () => {
    const repo = newRepo();
    const result = await processReferral(repo, {
      userId: "newbie",
      telegramId: 999,
      isNewProfile: true,
      initDataStartParam: null,
      clientParam: "ZZZZZZZZ",
    });
    expect(result).toMatchObject({ outcome: "skipped", reason: "unknown_code" });
    expect(repo.events.at(-1)).toMatchObject({ outcome: "skipped", reason: "unknown_code", codeRaw: "ZZZZZZZZ" });
  });

  it("(5) skips self-referral", async () => {
    const repo = new FakeRepo();
    repo.addProfile("self", { referralCode: "SELFCODE" });
    const result = await processReferral(repo, {
      userId: "self",
      telegramId: 999,
      isNewProfile: true,
      initDataStartParam: "SELFCODE",
      clientParam: null,
    });
    expect(result).toMatchObject({ outcome: "skipped", reason: "self_referral" });
  });

  it("(6) an old account with activity must not attach", async () => {
    const repo = newRepo();
    repo.profiles.get("newbie")!.accountCreatedAt = new Date(
      Date.now() - 2 * 86_400_000,
    ).toISOString();

    const oldAccount = await processReferral(repo, {
      userId: "newbie",
      telegramId: 999,
      isNewProfile: false,
      initDataStartParam: null,
      clientParam: REF_CODE,
    });
    expect(oldAccount).toMatchObject({ outcome: "skipped", reason: "account_too_old" });

    repo.addProfile("active", { completedTasks: 1 });
    const active = await processReferral(repo, {
      userId: "active",
      telegramId: 998,
      isNewProfile: false,
      initDataStartParam: null,
      clientParam: REF_CODE,
    });
    expect(active).toMatchObject({ outcome: "skipped", reason: "account_has_task_activity" });

    repo.addProfile("withdrawer", { withdrawals: 1 });
    const withdrawer = await processReferral(repo, {
      userId: "withdrawer",
      telegramId: 997,
      isNewProfile: false,
      initDataStartParam: null,
      clientParam: REF_CODE,
    });
    expect(withdrawer).toMatchObject({ outcome: "skipped", reason: "account_has_withdrawals" });
  });

  it("(7) a double auth call applies the referral only once", async () => {
    const repo = newRepo();
    const first = await processReferral(repo, {
      userId: "newbie",
      telegramId: 999,
      isNewProfile: true,
      initDataStartParam: REF_CODE,
      clientParam: null,
    });
    const second = await processReferral(repo, {
      userId: "newbie",
      telegramId: 999,
      isNewProfile: false,
      initDataStartParam: REF_CODE,
      clientParam: null,
    });

    expect(first.outcome).toBe("applied");
    expect(second).toMatchObject({ outcome: "skipped", reason: "already_referred" });
  });

  it("(8) a profile pre-created by another path can still attach", async () => {
    const repo = newRepo();
    // Not created by this login; still fresh and idle, so eligible.
    const result = await processReferral(repo, {
      userId: "newbie",
      telegramId: 999,
      isNewProfile: false,
      initDataStartParam: null,
      clientParam: REF_CODE,
    });
    expect(result.outcome).toBe("applied");
  });

  it("accepts a CODE_suffix tag, resolving against the base code", async () => {
    const repo = newRepo();
    const result = await processReferral(repo, {
      userId: "newbie",
      telegramId: 999,
      isNewProfile: true,
      initDataStartParam: null,
      clientParam: "0cc06d6d_tt",
    });
    expect(result.outcome).toBe("applied");
    expect(repo.profiles.get("newbie")?.referredBy).toBe("referrer");
  });

  it("records a none/skipped event for a new login with no code", async () => {
    const repo = newRepo();
    const result = await processReferral(repo, {
      userId: "newbie",
      telegramId: 999,
      isNewProfile: true,
      initDataStartParam: null,
      clientParam: null,
    });
    expect(result).toMatchObject({ source: "none", outcome: "skipped", reason: "no_code" });
    expect(repo.events).toHaveLength(1);
  });

  it("skips an invalid code", async () => {
    const repo = newRepo();
    const result = await processReferral(repo, {
      userId: "newbie",
      telegramId: 999,
      isNewProfile: true,
      initDataStartParam: null,
      clientParam: "not a code!!",
    });
    expect(result).toMatchObject({ outcome: "skipped", reason: "invalid_code" });
  });
});
