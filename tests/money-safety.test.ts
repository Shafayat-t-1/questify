import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdmin, type RpcResult } from "./helpers/fake-admin";
import {
  SETTINGS_DEFAULTS,
  invalidateSettingsCache,
  loadSettings,
  parseSettings,
} from "@/lib/settings";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { isValidIdempotencyKey } from "@/lib/idempotency";
import { signSession } from "@/lib/session";

/**
 * Money-safety phase-2 tests.
 *
 * The reward/admin routes are driven with an injected fake Supabase client whose
 * RPC handler mirrors the SQL semantics (idempotent replay, completion caps,
 * fixed-window limiting, the reject-refund guard). This verifies the HTTP
 * contract and the intended semantics; the migrations themselves are NOT run
 * against a real Postgres here (see REPORT_PHASE2.md).
 */

const holder = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => holder.admin,
  isSupabaseConfigured: Boolean(holder.admin),
  supabase: null,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const WITHDRAWAL_ID = "33333333-3333-4333-8333-333333333333";
const BEP20 = "0x" + "a".repeat(40);

let db: FakeAdmin;
let token: string;

function resetAdmin(): void {
  db = new FakeAdmin();
  holder.admin = db;
  invalidateSettingsCache();
}

beforeAll(() => {
  process.env.QUESTIFY_JWT_SECRET = "test-secret-value-at-least-32-bytes-long!!";
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.DEMO_MODE;
  token = signSession({ sub: USER_ID, tg: 424242 });
});

beforeEach(() => {
  resetAdmin();
});

afterEach(() => {
  holder.admin = null;
  invalidateSettingsCache();
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Pure units
// ---------------------------------------------------------------------------

describe("parseSettings", () => {
  it("falls back to safe defaults for missing keys", () => {
    const s = parseSettings([]);
    expect(s.minWithdrawalUsdt).toBe(SETTINGS_DEFAULTS.minWithdrawalUsdt);
    expect(s.coinToUsdtRate).toBe(SETTINGS_DEFAULTS.coinToUsdtRate);
    expect(s.rateLimits.withdraw).toEqual(SETTINGS_DEFAULTS.rateLimits.withdraw);
  });

  it("coerces and clamps provided rows", () => {
    const s = parseSettings([
      { key: "min_withdrawal_usdt", value: 5 },
      { key: "coin_to_usdt_rate", value: 0.001 },
      { key: "level_coins_per_level", value: 0 },
      { key: "checkin_reward_schedule", value: [1, 2, 3] },
    ]);
    expect(s.minWithdrawalUsdt).toBe(5);
    expect(s.coinToUsdtRate).toBe(0.001);
    expect(s.levelCoinsPerLevel).toBe(1); // clamped away from zero
    expect(s.checkinRewardSchedule).toEqual([1, 2, 3]);
  });
});

describe("isValidIdempotencyKey", () => {
  it("accepts url-safe keys of 8..64 chars", () => {
    expect(isValidIdempotencyKey("abc-DEF_123")).toBe(true);
  });
  it("rejects short, empty, non-string and over-long keys", () => {
    expect(isValidIdempotencyKey("short")).toBe(false);
    expect(isValidIdempotencyKey("")).toBe(false);
    expect(isValidIdempotencyKey(42)).toBe(false);
    expect(isValidIdempotencyKey("x".repeat(65))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rate limiter wrapper
// ---------------------------------------------------------------------------

describe("checkRateLimit", () => {
  it("allows when the DB counter is within the window", async () => {
    db.rpcHandler = async () => ({ data: true, error: null });
    const out = await checkRateLimit(db as never, "withdraw", USER_ID);
    expect(out.allowed).toBe(true);
  });

  it("denies when the DB counter is exceeded and maps to 429 + Retry-After", async () => {
    db.rpcHandler = async () => ({ data: false, error: null });
    const out = await checkRateLimit(db as never, "withdraw", USER_ID);
    expect(out.allowed).toBe(false);
    const res = rateLimitedResponse(out);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("300");
  });

  it("fails OPEN when the limiter RPC errors (e.g. migration not yet applied)", async () => {
    db.rpcHandler = async () => ({ data: null, error: { message: "function does not exist" } });
    const out = await checkRateLimit(db as never, "withdraw", USER_ID);
    expect(out.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rewards route
// ---------------------------------------------------------------------------

describe("POST /api/rewards", () => {
  async function loadRewards() {
    return import("@/app/api/rewards/route");
  }

  function taskTable() {
    db.tables.tasks = [
      {
        id: TASK_ID,
        platform: "x",
        is_active: true,
        verification_type: null,
        verification_target: null,
        verification_rules: null,
      },
    ];
  }

  it("forwards the client idempotency key on withdrawal and never double-debits a replay", async () => {
    const rows: Array<Record<string, unknown>> = [];
    db.rpcHandler = async (name, args) => {
      if (name === "check_rate_limit") return { data: true, error: null };
      if (name === "request_withdrawal") {
        const key = args.p_idempotency_key as string | null;
        const existing = key ? rows.find((r) => r.idempotency_key === key) : undefined;
        if (existing) return { data: existing, error: null };
        const row = { id: WITHDRAWAL_ID, amount_usdt: args.p_amount, idempotency_key: key };
        rows.push(row);
        return { data: row, error: null };
      }
      return { data: null, error: null };
    };

    const { POST } = await loadRewards();
    const body = { action: "withdraw", amount: 5, network: "BEP20", address: BEP20, idempotencyKey: "idem-key-0001" };

    const first = await POST(jsonRequest("/api/rewards", body));
    const second = await POST(jsonRequest("/api/rewards", body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(rows).toHaveLength(1); // replay did not create a second withdrawal

    const call = db.rpcCalls.find((c) => c.name === "request_withdrawal");
    expect(call?.args.p_idempotency_key).toBe("idem-key-0001");
  });

  it("returns replayed=true for a repeated task claim and forwards the key", async () => {
    taskTable();
    const seen = new Set<string>();
    db.rpcHandler = async (name, args) => {
      if (name === "check_rate_limit") return { data: true, error: null };
      if (name === "claim_task") {
        const key = args.p_idempotency_key as string;
        if (seen.has(key)) return { data: { coins: 100, usdt: 0.01, replayed: true }, error: null };
        seen.add(key);
        return { data: { coins: 100, usdt: 0.01 }, error: null };
      }
      return { data: null, error: null };
    };

    const { POST } = await loadRewards();
    const body = { action: "claim_task", taskId: TASK_ID, idempotencyKey: "idem-claim-01" };

    const first = (await (await POST(jsonRequest("/api/rewards", body))).json()) as { data?: { replayed?: boolean } };
    const second = (await (await POST(jsonRequest("/api/rewards", body))).json()) as { data?: { replayed?: boolean } };

    expect(first.data?.replayed).toBeUndefined();
    expect(second.data?.replayed).toBe(true);
    const call = db.rpcCalls.find((c) => c.name === "claim_task");
    expect(call?.args.p_idempotency_key).toBe("idem-claim-01");
  });

  it("returns 429 and does not call the money RPC when rate limited", async () => {
    db.rpcHandler = async (name) => {
      if (name === "check_rate_limit") return { data: false, error: null };
      return { data: null, error: null };
    };
    const { POST } = await loadRewards();
    const res = await POST(
      jsonRequest("/api/rewards", { action: "withdraw", amount: 5, network: "BEP20", address: BEP20 }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(db.rpcCalls.some((c) => c.name === "request_withdrawal")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Admin route
// ---------------------------------------------------------------------------

describe("POST /api/admin", () => {
  async function loadAdmin() {
    return import("@/app/api/admin/route");
  }

  function adminProfile() {
    db.tables.profiles = [{ id: USER_ID, is_admin: true }];
  }

  it("requires a tx_hash before marking a withdrawal paid", async () => {
    adminProfile();
    db.rpcHandler = async () => ({ data: { ok: true }, error: null });
    const { POST } = await loadAdmin();

    const res = await POST(
      jsonRequest("/api/admin", { action: "update_withdrawal", withdrawalId: WITHDRAWAL_ID, status: "paid" }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("tx_hash_required");
    expect(db.rpcCalls.some((c) => c.name === "admin_update_withdrawal")).toBe(false);
  });

  it("forwards the tx_hash when approving", async () => {
    adminProfile();
    db.rpcHandler = async () => ({ data: { ok: true }, error: null });
    const { POST } = await loadAdmin();

    const res = await POST(
      jsonRequest("/api/admin", {
        action: "update_withdrawal",
        withdrawalId: WITHDRAWAL_ID,
        status: "paid",
        tx_hash: "0xdeadbeefdeadbeef",
      }),
    );
    expect(res.status).toBe(200);
    const call = db.rpcCalls.find((c) => c.name === "admin_update_withdrawal");
    expect(call?.args.p_tx_hash).toBe("0xdeadbeefdeadbeef");
  });

  it("refund guard: a rejected withdrawal cannot be refunded twice", async () => {
    adminProfile();
    // Mirror the SQL: refund only from pending/processing, terminal states frozen.
    const state = { status: "pending", balance: 0 };
    db.rpcHandler = async (name, args): Promise<RpcResult> => {
      if (name === "admin_update_withdrawal") {
        const next = args.p_status as string;
        if ((state.status === "paid" || state.status === "rejected") && next !== state.status) {
          return { data: null, error: { message: "withdrawal is already terminal" } };
        }
        if (next === "rejected" && (state.status === "pending" || state.status === "processing")) {
          state.balance += 5;
        }
        state.status = next;
        return { data: { status: next }, error: null };
      }
      return { data: null, error: null };
    };
    const { POST } = await loadAdmin();

    const reject = await POST(
      jsonRequest("/api/admin", { action: "update_withdrawal", withdrawalId: WITHDRAWAL_ID, status: "rejected" }),
    );
    expect(reject.status).toBe(200);
    expect(state.balance).toBe(5);

    // Attempt to reopen then re-reject — both must be refused, no second refund.
    const reopen = await POST(
      jsonRequest("/api/admin", { action: "update_withdrawal", withdrawalId: WITHDRAWAL_ID, status: "pending" }),
    );
    const reReject = await POST(
      jsonRequest("/api/admin", { action: "update_withdrawal", withdrawalId: WITHDRAWAL_ID, status: "rejected" }),
    );
    expect(reopen.status).toBe(400);
    // Re-rejecting an already-rejected row is a safe no-op (no second refund).
    expect(reReject.status).toBe(200);
    expect(state.balance).toBe(5);
  });

  it("rejects an out-of-range setting and accepts a valid one (live, cache invalidated)", async () => {
    adminProfile();
    db.tables.platform_settings = [{ key: "min_withdrawal_usdt", value: 2 }];
    db.rpcHandler = async (name, args): Promise<RpcResult> => {
      if (name === "admin_set_setting") {
        db.tables.platform_settings = [{ key: args.p_key as string, value: args.p_value }];
        return { data: { key: args.p_key, value: args.p_value }, error: null };
      }
      return { data: null, error: null };
    };
    const { POST } = await loadAdmin();

    // Prime the cache with the old value.
    expect((await loadSettings(db as never)).minWithdrawalUsdt).toBe(2);

    const bad = await POST(
      jsonRequest("/api/admin", { action: "update_settings", key: "min_withdrawal_usdt", value: -1 }),
    );
    expect(bad.status).toBe(400);

    const good = await POST(
      jsonRequest("/api/admin", { action: "update_settings", key: "min_withdrawal_usdt", value: 7 }),
    );
    expect(good.status).toBe(200);
    // No redeploy: the next read reflects the new value because the route
    // invalidated the in-process cache.
    expect((await loadSettings(db as never)).minWithdrawalUsdt).toBe(7);
  });
});
