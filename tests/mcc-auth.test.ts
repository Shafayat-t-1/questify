import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdmin } from "./helpers/fake-admin";
import {
  MCC_SESSION_COOKIE,
  mccClearCookieHeader,
  mccCookieHeader,
  signSession,
  verifySessionToken,
} from "@/lib/session";
import {
  verifyMccToken,
  authenticateMcc,
  loadMccAdminProfile,
} from "@/lib/mcc-auth";
import { verifyTelegramLoginWidget } from "@/lib/telegram-login";

/**
 * Phase 3A (Master Control Center) tests.
 *
 * Covers the two security-critical pieces that make /mcc safe:
 *   1. the Telegram Login Widget HMAC verifier (legacy widget scheme — NOT the
 *      Mini App initData scheme), including tamper and replay rejection;
 *   2. the cookie session gate (`purpose: "mcc"`, admin enforcement).
 * Plus static assertions on the 006 migration (the SQL is never run against a
 * live Postgres here — see REPORT_PHASE3A.md).
 */

const holder = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => holder.admin,
  isSupabaseConfigured: Boolean(holder.admin),
  supabase: null,
}));

const BOT_TOKEN = "123456:TEST-BOT-TOKEN-for-mcc";
const BOT_USERNAME = "questify_test_bot";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TG_ID = 555001;

let db: FakeAdmin;

beforeAll(() => {
  process.env.QUESTIFY_JWT_SECRET = "test-secret-value-at-least-32-bytes-long!!";
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
});

beforeEach(() => {
  db = new FakeAdmin();
  holder.admin = db;
  db.rpcHandler = async () => ({ data: null, error: null });
});

afterEach(() => {
  holder.admin = null;
});

// ---------------------------------------------------------------------------
// Telegram Login Widget verifier
// ---------------------------------------------------------------------------

function dataCheckString(fields: Record<string, string | number>): string {
  return Object.entries(fields)
    .filter(([key]) => key !== "hash")
    .map(([key, value]) => [key, String(value)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

/** Correct widget scheme: secret_key = SHA256(bot_token), raw digest. */
function widgetHash(fields: Record<string, string | number>): string {
  const secret = createHash("sha256").update(BOT_TOKEN).digest();
  return createHmac("sha256", secret).update(dataCheckString(fields)).digest("hex");
}

/** WRONG scheme (the Mini App one) — must never validate a widget payload. */
function initDataStyleHash(fields: Record<string, string | number>): string {
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  return createHmac("sha256", secret).update(dataCheckString(fields)).digest("hex");
}

function widgetFields(
  overrides: Record<string, string | number> = {},
): Record<string, string | number> {
  const base: Record<string, string | number> = {
    id: TG_ID,
    first_name: "Ada",
    username: "ada_admin",
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  return { ...base, hash: widgetHash(base) };
}

describe("verifyTelegramLoginWidget", () => {
  it("accepts a correctly signed, fresh payload", () => {
    const user = verifyTelegramLoginWidget(widgetFields(), BOT_TOKEN);
    expect(user).not.toBeNull();
    expect(user?.id).toBe(TG_ID);
    expect(user?.username).toBe("ada_admin");
  });

  it("rejects any tampered field (hash no longer matches)", () => {
    const fields = widgetFields();
    fields.first_name = "Mallory";
    expect(verifyTelegramLoginWidget(fields, BOT_TOKEN)).toBeNull();
  });

  it("rejects a stale auth_date (replay defence)", () => {
    const old = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 3;
    expect(verifyTelegramLoginWidget(widgetFields({ auth_date: old }), BOT_TOKEN)).toBeNull();
  });

  it("does NOT accept the Mini App initData hash scheme", () => {
    const base = { id: TG_ID, first_name: "Ada", auth_date: Math.floor(Date.now() / 1000) };
    const fields = { ...base, hash: initDataStyleHash(base) };
    expect(verifyTelegramLoginWidget(fields, BOT_TOKEN)).toBeNull();
  });

  it("rejects a payload signed with a different bot token", () => {
    const base = { id: TG_ID, first_name: "Ada", auth_date: Math.floor(Date.now() / 1000) };
    const secret = createHash("sha256").update("999:OTHER-TOKEN").digest();
    const hash = createHmac("sha256", secret).update(dataCheckString(base)).digest("hex");
    expect(verifyTelegramLoginWidget({ ...base, hash }, BOT_TOKEN)).toBeNull();
  });

  it("rejects malformed payloads (missing fields / bad hash shape)", () => {
    expect(verifyTelegramLoginWidget({ id: TG_ID }, BOT_TOKEN)).toBeNull();
    const good = widgetFields();
    expect(verifyTelegramLoginWidget({ ...good, hash: "zz" }, BOT_TOKEN)).toBeNull();
    expect(verifyTelegramLoginWidget({}, "")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cookie session
// ---------------------------------------------------------------------------

describe("MCC cookie session", () => {
  it("verifies an MCC-scoped token and rejects a Mini App token", () => {
    const mcc = signSession({ sub: ADMIN_ID, tg: TG_ID, purpose: "mcc" }, 3600);
    expect(verifyMccToken(mcc)?.purpose).toBe("mcc");

    const miniApp = signSession({ sub: ADMIN_ID, tg: TG_ID }, 3600);
    expect(verifySessionToken(miniApp)).not.toBeNull(); // valid session…
    expect(verifyMccToken(miniApp)).toBeNull(); // …but not an MCC cookie
  });

  it("rejects an expired MCC token", () => {
    const expired = signSession(
      { sub: ADMIN_ID, purpose: "mcc", exp: Math.floor(Date.now() / 1000) - 5 },
      3600,
    );
    expect(verifyMccToken(expired)).toBeNull();
  });

  it("builds hardened Set-Cookie headers", () => {
    const set = mccCookieHeader("tok", 600);
    expect(set).toContain(`${MCC_SESSION_COOKIE}=tok`);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Max-Age=600");
    const clear = mccClearCookieHeader();
    expect(clear).toContain("Max-Age=0");
  });
});

// ---------------------------------------------------------------------------
// authenticateMcc (cookie → profile → is_admin)
// ---------------------------------------------------------------------------

function cookieRequest(token: string | null, url = "http://localhost/api/mcc/live"): Request {
  return new Request(url, {
    headers: token ? { cookie: `${MCC_SESSION_COOKIE}=${token}` } : {},
  });
}

describe("authenticateMcc", () => {
  it("accepts a valid MCC cookie whose profile is admin", async () => {
    db.tables.profiles = [{ id: ADMIN_ID, telegram_id: TG_ID, is_admin: true, is_founder: true, username: "owner" }];
    const token = signSession({ sub: ADMIN_ID, tg: TG_ID, purpose: "mcc" }, 3600);
    const res = await authenticateMcc(cookieRequest(token));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.context.adminId).toBe(ADMIN_ID);
      expect(res.context.isFounder).toBe(true);
    }
  });

  it("rejects requests without a cookie (401)", async () => {
    const res = await authenticateMcc(cookieRequest(null));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("rejects a valid session whose profile is not admin (403)", async () => {
    db.tables.profiles = [{ id: USER_ID, telegram_id: TG_ID, is_admin: false }];
    const token = signSession({ sub: USER_ID, tg: TG_ID, purpose: "mcc" }, 3600);
    const res = await authenticateMcc(cookieRequest(token));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it("fails closed when no profile row exists", async () => {
    expect(await loadMccAdminProfile(ADMIN_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /api/mcc-auth
// ---------------------------------------------------------------------------

function authRequest(body: unknown): Request {
  return new Request("http://localhost/api/mcc-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mcc-auth", () => {
  async function loadRoute() {
    return import("@/app/api/mcc-auth/route");
  }

  it("mints an httpOnly cookie for an admin telegram account", async () => {
    db.tables.profiles = [{ id: ADMIN_ID, telegram_id: TG_ID, is_admin: true }];
    const { POST } = await loadRoute();
    const res = await POST(authRequest(widgetFields()));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${MCC_SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
  });

  it("rejects an unsigned / forged payload (401)", async () => {
    db.tables.profiles = [{ id: ADMIN_ID, telegram_id: TG_ID, is_admin: true }];
    const { POST } = await loadRoute();
    const res = await POST(
      authRequest({ id: TG_ID, first_name: "Ada", auth_date: Math.floor(Date.now() / 1000), hash: "0".repeat(64) }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a valid telegram login with no admin profile (403, no cookie)", async () => {
    db.tables.profiles = [{ id: USER_ID, telegram_id: TG_ID, is_admin: false }];
    const { POST } = await loadRoute();
    const res = await POST(authRequest(widgetFields()));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses an unknown telegram account (403, no cookie)", async () => {
    db.tables.profiles = [];
    const { POST } = await loadRoute();
    const res = await POST(authRequest(widgetFields()));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rate-limits repeated logins (429)", async () => {
    db.tables.profiles = [{ id: ADMIN_ID, telegram_id: TG_ID, is_admin: true }];
    db.rpcHandler = async (name) =>
      name === "check_rate_limit" ? { data: false, error: null } : { data: null, error: null };
    const { POST } = await loadRoute();
    const res = await POST(authRequest(widgetFields()));
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// /api/admin over the cookie path (reason required on adjustments)
// ---------------------------------------------------------------------------

describe("POST /api/admin via MCC cookie", () => {
  it("rejects a balance adjustment with no reason (400, RPC never called)", async () => {
    db.tables.profiles = [{ id: ADMIN_ID, is_admin: true }];
    const token = signSession({ sub: ADMIN_ID, tg: TG_ID, purpose: "mcc" }, 3600);
    const { POST } = await import("@/app/api/admin/route");
    const res = await POST(
      new Request("http://localhost/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `${MCC_SESSION_COOKIE}=${token}` },
        body: JSON.stringify({ action: "adjust_balance", userId: USER_ID, delta_coins: 100 }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("reason_required");
    expect(db.rpcCalls.some((c) => c.name === "admin_adjust_balance")).toBe(false);
  });

  it("passes a reasoned adjustment through to the audited RPC (200)", async () => {
    db.tables.profiles = [{ id: ADMIN_ID, is_admin: true }];
    db.rpcHandler = async (name) =>
      name === "admin_adjust_balance" ? { data: { id: USER_ID }, error: null } : { data: null, error: null };
    const token = signSession({ sub: ADMIN_ID, tg: TG_ID, purpose: "mcc" }, 3600);
    const { POST } = await import("@/app/api/admin/route");
    const res = await POST(
      new Request("http://localhost/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `${MCC_SESSION_COOKIE}=${token}` },
        body: JSON.stringify({
          action: "adjust_balance",
          userId: USER_ID,
          delta_coins: 100,
          reason: "support goodwill",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const call = db.rpcCalls.find((c) => c.name === "admin_adjust_balance");
    expect(call?.args.p_reason).toBe("support goodwill");
  });
});

// ---------------------------------------------------------------------------
// Migration 006 — static review (never executed here)
// ---------------------------------------------------------------------------

describe("006_mcc_control_center.sql (static)", () => {
  const sql = readFileSync("supabase/migrations/006_mcc_control_center.sql", "utf8");

  it("records the next schema version (0008) and stays idempotent", () => {
    expect(sql).toContain("'0008-mcc-control-center'");
    expect(sql).toContain("on conflict (version) do nothing");
    expect(sql).toContain("add column if not exists is_founder");
    expect(sql).toContain("create table if not exists public.mcc_live_ticks");
    expect(sql).toContain("drop trigger if exists");
  });

  it("never performs destructive DDL/DML", () => {
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate/i);
    expect(sql).not.toMatch(/delete\s+from/i);
  });

  it("redefines both reward RPCs with a ban guard at the same signature", () => {
    expect(sql).toContain("create or replace function public.claim_task(");
    expect(sql).toContain("create or replace function public.claim_daily_checkin(");
    const banGuards = sql.match(/account suspended/g) ?? [];
    expect(banGuards.length).toBeGreaterThanOrEqual(2); // claim_task + checkin
    expect(sql).toContain("using errcode = '42501'");
  });

  it("requires a non-blank reason before any balance moves", () => {
    expect(sql).toContain("length(btrim(p_reason)) < 1");
    expect(sql).toContain("reason is required");
  });

  it("exposes the founder flag and the referral chain in admin search", () => {
    expect(sql).toContain("is_founder   is distinct from old.is_founder");
    expect(sql).toContain("is_admin, is_founder, referred_by, referred_by_tier2");
  });

  it("wires the realtime heartbeat without exposing money tables to anon", () => {
    expect(sql).toContain("mcc_live_ticks_read");
    expect(sql).toContain("alter publication supabase_realtime add table public");
    expect(sql).toContain("owner_wallet_ledger");
    expect(sql).toMatch(/grant select on public\.mcc_live_ticks to anon, authenticated/);
  });
});

// Sanity: the widget verifier and bot username constants are referenced (docs
// the operator must set with @BotFather).
it("documents the domain requirement (bot username constant present)", () => {
  expect(BOT_USERNAME).toMatch(/bot$/);
});
