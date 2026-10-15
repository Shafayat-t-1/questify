import { describe, expect, it } from "vitest";
import { netAfterFee, pctOf, roundUsdt, splitMargin } from "@/lib/wallet";
import { parseSettings, SETTINGS_DEFAULTS, type MilestoneRule } from "@/lib/settings";

/**
 * Dual-wallet phase-2B tests.
 *
 * The authoritative money math lives in the SECURITY DEFINER RPCs of
 * `supabase/migrations/005_dual_wallet_referral.sql`. Those migrations are NOT
 * run against a real Postgres here (see REPORT_PHASE2B.md). Instead this file:
 *   1. unit-tests the shared pure helpers (`lib/wallet.ts`) that encode the same
 *      rounding contract, and
 *   2. drives an in-memory model whose semantics mirror the SQL (ledger-backed
 *      balances, per-reference idempotency, the "paid only from marketing"
 *      rule, the atomic instant-bonus flag, once-per-threshold milestones).
 * It verifies the INTENDED semantics; the SQL itself still needs a live run.
 */

const CFG = {
  ownerPct: 0.95,
  mktPct: 0.05,
  t1: 0.03,
  t2: 0.02,
  bonusCoins: 150,
  bonusUsdt: 0.03,
  minTasks: 3,
  milestones: [
    { referralCount: 5, bonusUsdt: 1 },
    { referralCount: 25, bonusUsdt: 5 },
  ] as MilestoneRule[],
};
type Config = typeof CFG;

// ---------------------------------------------------------------------------
// In-memory model of the ledger + referral payout rules
// ---------------------------------------------------------------------------

interface Entry {
  type: string;
  amount: number;
  ref: string | null;
}

class WalletSim {
  owner: Entry[] = [];
  marketing: Entry[] = [];
  ownerBalance = 0;
  marketingBalance = 0;
  bonusPaid = new Set<string>();
  milestones = new Set<string>();

  ownerAppend(amount: number, ref: string | null, type = "task_margin_in"): number | null {
    if (ref && this.owner.some((e) => e.ref === ref)) return null;
    this.owner.push({ type, amount, ref });
    this.ownerBalance = roundUsdt(this.ownerBalance + amount);
    return this.ownerBalance;
  }

  mktAppend(amount: number, ref: string | null): number | null {
    if (ref && this.marketing.some((e) => e.ref === ref)) return null;
    this.marketing.push({ type: "task_margin_in", amount, ref });
    this.marketingBalance = roundUsdt(this.marketingBalance + amount);
    return this.marketingBalance;
  }

  /** Mirrors marketing_wallet_payout: never debits below zero. */
  payout(amount: number, ref: string | null): "paid" | "insufficient" | "duplicate" | "noop" {
    if (amount <= 0) return "noop";
    if (
      ref &&
      this.marketing.some(
        (e) => e.ref === ref && (e.type === "referral_payout_out" || e.type === "insufficient_marketing_funds"),
      )
    ) {
      return "duplicate";
    }
    if (this.marketingBalance >= amount) {
      this.marketing.push({ type: "referral_payout_out", amount: -amount, ref });
      this.marketingBalance = roundUsdt(this.marketingBalance - amount);
      return "paid";
    }
    this.marketing.push({ type: "insufficient_marketing_funds", amount: 0, ref });
    return "insufficient";
  }

  insufficiencies(): number {
    return this.marketing.filter((e) => e.type === "insufficient_marketing_funds").length;
  }
}

interface ClaimOpts {
  uid: string;
  ref?: string | null;
  ref2?: string | null;
  margin: number;
  completedTasks: number;
  referralCount?: number;
}

interface Payout {
  user: string;
  usdt: number;
  coins: number;
}

/** Mirrors claim_task: margin split + tiered commission + bonus + milestones. */
function claim(w: WalletSim, o: ClaimOpts, cfg: Config = CFG): Payout[] {
  const payouts: Payout[] = [];
  const task = "t";

  if (o.margin > 0) {
    const { owner, marketing } = splitMargin(o.margin, cfg.ownerPct, cfg.mktPct);
    w.ownerAppend(owner, `${o.uid}:${task}`);
    w.mktAppend(marketing, `${o.uid}:${task}`);
  }

  if (o.margin > 0) {
    if (o.ref && o.ref !== o.uid && cfg.t1 > 0) {
      const p = pctOf(o.margin, cfg.t1);
      if (p > 0 && w.payout(p, `tier1:${o.uid}:${task}`) === "paid") {
        payouts.push({ user: o.ref, usdt: p, coins: 0 });
      }
    }
    if (o.ref2 && o.ref2 !== o.uid && o.ref2 !== o.ref && cfg.t2 > 0) {
      const p = pctOf(o.margin, cfg.t2);
      if (p > 0 && w.payout(p, `tier2:${o.uid}:${task}`) === "paid") {
        payouts.push({ user: o.ref2, usdt: p, coins: 0 });
      }
    }
  }

  if (o.ref) {
    if (o.completedTasks >= cfg.minTasks && !w.bonusPaid.has(o.uid)) {
      w.bonusPaid.add(o.uid); // atomic flag claim
      const res = cfg.bonusUsdt > 0 ? w.payout(cfg.bonusUsdt, null) : "paid";
      if (res === "paid") {
        payouts.push({ user: o.ref, usdt: cfg.bonusUsdt, coins: cfg.bonusCoins });
      } else {
        w.bonusPaid.delete(o.uid); // release so a later completion retries
      }
    }
    for (const m of cfg.milestones) {
      const key = `${o.ref}:${m.referralCount}`;
      if ((o.referralCount ?? 0) >= m.referralCount && !w.milestones.has(key)) {
        if (w.payout(m.bonusUsdt, null) === "paid") {
          payouts.push({ user: o.ref, usdt: m.bonusUsdt, coins: 0 });
          w.milestones.add(key);
        }
      }
    }
  }

  return payouts;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("wallet helpers", () => {
  it("splitMargin always sums back to the margin (no rounding leak)", () => {
    for (const margin of [0.01, 0.1, 1, 9.99, 0.333333, 123.456789, 1000]) {
      const { owner, marketing } = splitMargin(margin, 0.95, 0.05);
      expect(roundUsdt(owner + marketing)).toBe(margin);
    }
  });

  it("splitMargin gives the rounding remainder to the owner", () => {
    // 0.333333 * 0.05 = 0.01666665 -> rounds to 0.016667; owner keeps the rest.
    const { owner, marketing } = splitMargin(0.333333, 0.95, 0.05);
    expect(marketing).toBe(0.016667);
    expect(owner).toBe(roundUsdt(0.333333 - 0.016667));
  });

  it("clamps out-of-range splits and non-positive margins", () => {
    // Each percentage is clamped to [0,1] independently (matching the SQL), so a
    // marketing share above 1 becomes 1 and the owner keeps the remainder.
    expect(splitMargin(10, -1, 2)).toEqual({ owner: 0, marketing: 10 });
    expect(splitMargin(-5, 0.5, 0.5)).toEqual({ owner: 0, marketing: 0 });
  });

  it("pctOf rounds to 6dp and netAfterFee never goes negative", () => {
    expect(pctOf(100, 0.03)).toBe(3);
    expect(netAfterFee(10, 1)).toBe(9);
    expect(netAfterFee(0.5, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Margin split wiring
// ---------------------------------------------------------------------------

describe("claim_task margin split", () => {
  it("credits the owner and marketing wallets so they add up to the margin", () => {
    const w = new WalletSim();
    claim(w, { uid: "u1", margin: 100, completedTasks: 0 });
    expect(w.ownerBalance).toBe(95);
    expect(w.marketingBalance).toBe(5);
    expect(w.ownerBalance + w.marketingBalance).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Tier-1 / Tier-2 commission
// ---------------------------------------------------------------------------

describe("tiered referral commission", () => {
  it("pays Tier-1 and Tier-2 from the marketing wallet, never the owner wallet", () => {
    const w = new WalletSim();
    const outs = claim(w, { uid: "u1", ref: "r1", ref2: "r2", margin: 100, completedTasks: 1 });

    expect(outs).toContainEqual({ user: "r1", usdt: 3, coins: 0 });
    expect(outs).toContainEqual({ user: "r2", usdt: 2, coins: 0 });
    expect(w.ownerBalance).toBe(95); // owner earnings untouched
    expect(w.marketingBalance).toBe(0); // 5 funded - 3 - 2
  });

  it("skips Tier-2 when the referrer has no referrer of their own", () => {
    const w = new WalletSim();
    const outs = claim(w, { uid: "u1", ref: "r1", margin: 100, completedTasks: 1 });

    expect(outs.some((o) => o.user === "r2")).toBe(false);
    expect(w.marketingBalance).toBe(2); // only the 3 USDT tier-1 commission paid
  });

  it("never pays a Tier-2 commission back to the user or the direct referrer", () => {
    const w = new WalletSim();
    const selfRef = claim(w, {
      uid: "u1",
      ref: "u1",
      ref2: "u1",
      margin: 100,
      completedTasks: 0,
    });
    expect(selfRef).toEqual([]);
    expect(w.marketingBalance).toBe(5); // nothing paid, reserve intact

    const loop = new WalletSim();
    const bothRef = claim(loop, { uid: "u1", ref: "r1", ref2: "r1", margin: 100, completedTasks: 0 });
    expect(bothRef).toContainEqual({ user: "r1", usdt: 3, coins: 0 });
    expect(bothRef.some((o) => o.usdt === 2)).toBe(false); // r2 === r1 is skipped
  });
});

// ---------------------------------------------------------------------------
// Instant referral bonus
// ---------------------------------------------------------------------------

describe("instant referral bonus", () => {
  it("fires exactly once when the referred user reaches the task threshold", () => {
    const w = new WalletSim();
    claim(w, { uid: "u1", ref: "r1", margin: 100, completedTasks: 1 }); // funds marketing (5)

    const atTwo = claim(w, { uid: "u1", ref: "r1", margin: 0, completedTasks: 2 });
    expect(atTwo.some((o) => o.coins === 150)).toBe(false); // below threshold

    const atThree = claim(w, { uid: "u1", ref: "r1", margin: 0, completedTasks: 3 });
    expect(atThree).toContainEqual({ user: "r1", usdt: 0.03, coins: 150 });

    const atFour = claim(w, { uid: "u1", ref: "r1", margin: 0, completedTasks: 4 });
    expect(atFour.some((o) => o.coins === 150)).toBe(false); // never twice
  });
});

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

describe("referral milestones", () => {
  it("pays each threshold once and only when crossed", () => {
    const w = new WalletSim();
    w.mktAppend(100, "fund");

    const at5 = claim(w, { uid: "a", ref: "R", margin: 0, completedTasks: 0, referralCount: 5 });
    expect(at5).toContainEqual({ user: "R", usdt: 1, coins: 0 });

    const again5 = claim(w, { uid: "b", ref: "R", margin: 0, completedTasks: 0, referralCount: 5 });
    expect(again5.some((o) => o.usdt === 1)).toBe(false); // not paid twice

    const at25 = claim(w, { uid: "c", ref: "R", margin: 0, completedTasks: 0, referralCount: 25 });
    expect(at25).toContainEqual({ user: "R", usdt: 5, coins: 0 });
  });
});

// ---------------------------------------------------------------------------
// Insolvency safety
// ---------------------------------------------------------------------------

describe("marketing-wallet insolvency", () => {
  it("skips the payout, records the shortfall, and never touches the owner wallet", () => {
    const w = new WalletSim();
    // A misconfigured operator: tier-1 wants 50% of the margin but the marketing
    // split only funds 5%. The reserve cannot cover it.
    const bad: Config = { ...CFG, t1: 0.5 };
    const outs = claim(w, { uid: "u1", ref: "r1", margin: 100, completedTasks: 1 }, bad);

    expect(outs.some((o) => o.user === "r1")).toBe(false); // referrer not paid
    expect(w.insufficiencies()).toBe(1); // operator can see why
    expect(w.ownerBalance).toBe(95); // owner share intact and untouched
    expect(w.marketingBalance).toBe(5); // reserve not debited on a failed payout
  });
});

// ---------------------------------------------------------------------------
// Withdrawal fee
// ---------------------------------------------------------------------------

describe("withdrawal fee collection", () => {
  it("keeps the gross debit, records the net payout and credits the owner wallet", () => {
    const w = new WalletSim();
    const gross = 10;
    const fee = 1;

    expect(netAfterFee(gross, fee)).toBe(9); // what the user receives
    w.ownerAppend(fee, "fee:w1", "withdrawal_fee_in");
    expect(w.ownerBalance).toBe(1);
    expect(w.owner.some((e) => e.type === "withdrawal_fee_in" && e.ref === "fee:w1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Settings parsing
// ---------------------------------------------------------------------------

describe("parseSettings (dual wallet)", () => {
  it("falls back to the phase-2B defaults for missing keys", () => {
    const s = parseSettings([]);
    expect(s.ownerWalletSplitPct).toBe(0.95);
    expect(s.marketingWalletSplitPct).toBe(0.05);
    expect(s.referralTier1CommissionPct).toBe(0.03);
    expect(s.referralTier2CommissionPct).toBe(0.02);
    expect(s.referralMilestoneRules).toEqual(SETTINGS_DEFAULTS.referralMilestoneRules);
  });

  it("parses provided values, clamps the threshold and drops malformed milestones", () => {
    const s = parseSettings([
      { key: "owner_wallet_split_pct", value: 0.9 },
      { key: "marketing_wallet_split_pct", value: 0.1 },
      { key: "referral_tier1_commission_pct", value: 0.04 },
      { key: "referral_bonus_min_tasks", value: 0 },
      {
        key: "referral_milestone_rules",
        value: [
          { referral_count: 10, bonus_usdt: 2 },
          { referral_count: 0, bonus_usdt: 1 }, // dropped: count <= 0
          { referral_count: 3 }, // dropped: missing bonus
        ],
      },
    ]);
    expect(s.ownerWalletSplitPct).toBe(0.9);
    expect(s.marketingWalletSplitPct).toBe(0.1);
    expect(s.referralTier1CommissionPct).toBe(0.04);
    expect(s.referralBonusMinTasks).toBe(1); // clamped away from zero
    expect(s.referralMilestoneRules).toEqual([{ referralCount: 10, bonusUsdt: 2 }]);
  });
});
