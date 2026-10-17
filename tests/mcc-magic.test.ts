import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdmin } from "./helpers/fake-admin";
import {
  MCC_SESSION_COOKIE,
  signSession,
  verifySessionToken,
} from "@/lib/session";
import {
  MCC_MAGIC_PURPOSE,
  MCC_MAGIC_TTL_SECONDS,
  hashMccMagicToken,
  signMccMagicToken,
  verifyMccMagicToken,
} from "@/lib/mcc-magic";

/**
 * Phase 3A-FIX (bot-based magic-link MCC login) tests.
 *
 * Covers the primary /mcc auth path end to end at the unit level:
 *   1. the `/login` bot command — admin-only, silent for everyone else,
 *      rate-limited, stores only the SHA-256 hash of the raw token;
 *   2. /api/mcc-magic — one-time claim (replay rejected), expiry, non-admin
 *      rejection, forged-token rejection, cookie minting;
 *   3. the token primitives — distinct purpose/claim shape from the cookie.
 * Plus static assertions on migration 007 (never executed here — permanent
 * rule 11: no local Postgres).
 */

const holder = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => holder.admin,
  isSupabaseConfigured: Boolean(holder.admin),
  supabase: null,
}));

const BOT_TOKEN = "123456:TEST-BOT-TOKEN-for-mcc-magic";
const WEBHOOK_SECRET = "test-webhook-secret";
const APP_URL = "https://quest.example.test";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TG_ID = 777001;

let db: FakeAdmin;
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  process.env.QUESTIFY_JWT_SECRET = "test-secret-value-at-least-32-bytes-long!!";
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
});

beforeEach(() => {
  db = new FakeAdmin();
  holder.admin = db;
  db.rpcHandler = async (name) =>
    name === "check_rate_limit" ? { data: true, error: null } : { data: null, error: null };
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  holder.admin = null;
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function webhookRequest(text: string, fromId: number | undefined = TG_ID): Request {
  return new Request("http://localhost/api/bot/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      message: {
        chat: { id: fromId ?? TG_ID },
        ...(fromId !== undefined ? { from: { id: fromId } } : {}),
        text,
      },
    }),
  });
}

interface SentMessage {
  text: string;
  url: string | null;
}

function sentMessages(): SentMessage[] {
  const calls = fetchMock.mock.calls as Array<[string, { body: string }]>;
  return calls
    .filter(([url]) => String(url).includes("/sendMessage"))
    .map(([, init]) => {
      const body = JSON.parse(init.body) as {
        text: string;
        // sendMessage builds `inline_keyboard: [[button]]` — an array of rows,
        // each row an array of buttons (Telegram InlineKeyboardMarkup spec).
        reply_markup?: { inline_keyboard?: Array<Array<{ url?: string }>> };
      };
      return {
        text: body.text,
        url: body.reply_markup?.inline_keyboard?.[0]?.[0]?.url ?? null,
      };
    });
}

function magicRequest(token: string | null): Request {
  return new Request(
    `http://localhost/api/mcc-magic${token ? `?token=${encodeURIComponent(token)}` : ""}`,
  );
}

function locationOf(res: Response): string {
  return res.headers.get("location") ?? "";
}

function seedTokenRow(userId: string, expiresAtMs = MCC_MAGIC_TTL_SECONDS * 1000): string {
  const raw = signMccMagicToken(userId);
  db.tables.mcc_magic_tokens = [
    {
      token_hash: hashMccMagicToken(raw),
      user_id: userId,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + expiresAtMs).toISOString(),
      used_at: null,
    },
  ];
  return raw;
}

// ---------------------------------------------------------------------------
// Token primitives
// ---------------------------------------------------------------------------

describe("mcc magic token primitives", () => {
  it("round-trips with purpose mcc_magic bound to the user id", () => {
    const raw = signMccMagicToken(ADMIN_ID);
    const payload = verifyMccMagicToken(raw);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe(ADMIN_ID);
    expect(payload?.purpose).toBe(MCC_MAGIC_PURPOSE);
    expect(typeof payload?.jti).toBe("string");
  });

  it("never validates an mcc cookie session or a Mini App token", () => {
    const cookie = signSession({ sub: ADMIN_ID, tg: TG_ID, purpose: "mcc" }, 3600);
    const miniApp = signSession({ sub: ADMIN_ID, tg: TG_ID }, 3600);
    expect(verifyMccMagicToken(cookie)).toBeNull();
    expect(verifyMccMagicToken(miniApp)).toBeNull();
  });

  it("rejects an expired magic token", () => {
    const expired = signSession(
      {
        sub: ADMIN_ID,
        purpose: MCC_MAGIC_PURPOSE,
        jti: "deadbeef",
        exp: Math.floor(Date.now() / 1000) - 5,
      },
      300,
    );
    expect(verifyMccMagicToken(expired)).toBeNull();
  });

  it("hashes to SHA-256 hex and never equals the raw token", () => {
    const raw = signMccMagicToken(ADMIN_ID);
    const hash = hashMccMagicToken(raw);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// POST /api/bot/webhook — the /login command
// ---------------------------------------------------------------------------

describe("POST /api/bot/webhook /login", () => {
  async function loadRoute() {
    return import("@/app/api/bot/webhook/route");
  }

  it("replies to an admin with a signed single-use link and stores only the hash", async () => {
    db.tables.profiles = [{ id: ADMIN_ID, telegram_id: TG_ID, is_admin: true }];
    const { POST } = await loadRoute();
    const res = await POST(webhookRequest("/login"));
    expect(res.status).toBe(200);

    const messages = sentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].url).toContain(`${APP_URL}/mcc/magic?token=`);

    const raw = new URL(messages[0].url ?? "").searchParams.get("token") ?? "";
    const payload = verifyMccMagicToken(raw);
    expect(payload?.sub).toBe(ADMIN_ID);

    const rows = db.tables.mcc_magic_tokens ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(rows[0].token_hash).not.toBe(raw);
    expect(rows[0].user_id).toBe(ADMIN_ID);
    const remainingMs = Date.parse(String(rows[0].expires_at)) - Date.now();
    expect(remainingMs).toBeGreaterThan(MCC_MAGIC_TTL_SECONDS * 1000 - 10_000);
    expect(remainingMs).toBeLessThanOrEqual(MCC_MAGIC_TTL_SECONDS * 1000);
  });

  it("handles the /login@botname form Telegram sends in groups", async () => {
    db.tables.profiles = [{ id: ADMIN_ID, telegram_id: TG_ID, is_admin: true }];
    const { POST } = await loadRoute();
    const res = await POST(webhookRequest("/login@questify_app_bot"));
    expect(res.status).toBe(200);
    expect(sentMessages()).toHaveLength(1);
  });

  it("stays silent for a non-admin (no message, no token)", async () => {
    db.tables.profiles = [{ id: USER_ID, telegram_id: TG_ID, is_admin: false }];
    const { POST } = await loadRoute();
    const res = await POST(webhookRequest("/login"));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.tables.mcc_magic_tokens ?? []).toHaveLength(0);
  });

  it("stays silent for an unknown telegram id", async () => {
    db.tables.profiles = [];
    const { POST } = await loadRoute();
    const res = await POST(webhookRequest("/login"));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.tables.mcc_magic_tokens ?? []).toHaveLength(0);
  });

  it("enforces the hourly rate limit and mints no link when exceeded", async () => {
    db.tables.profiles = [{ id: ADMIN_ID, telegram_id: TG_ID, is_admin: true }];
    db.rpcHandler = async (name) =>
      name === "check_rate_limit" ? { data: false, error: null } : { data: null, error: null };
    const { POST } = await loadRoute();
    const res = await POST(webhookRequest("/login"));
    expect(res.status).toBe(200);

    const messages = sentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].text).not.toContain("/mcc/magic");
    expect(messages[0].text).not.toContain("token=");
    expect(messages[0].url).not.toContain("/mcc/magic");
    expect(db.tables.mcc_magic_tokens ?? []).toHaveLength(0);

    const call = db.rpcCalls.find((c) => c.name === "check_rate_limit");
    expect(call?.args.p_key).toBe(`rl:mcc_login_cmd:${TG_ID}`);
    expect(call?.args.p_max).toBe(5);
    expect(call?.args.p_window_seconds).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// GET /api/mcc-magic — redemption
// ---------------------------------------------------------------------------

describe("GET /api/mcc-magic", () => {
  async function loadRoute() {
    return import("@/app/api/mcc-magic/route");
  }

  function adminProfile() {
    return [{ id: ADMIN_ID, telegram_id: TG_ID, is_admin: true, is_founder: false, username: "owner" }];
  }

  it("mints an httpOnly MCC session once, then rejects the replay", async () => {
    db.tables.profiles = adminProfile();
    const raw = seedTokenRow(ADMIN_ID);
    const { GET } = await loadRoute();

    const res = await GET(magicRequest(raw));
    expect(locationOf(res)).toBe("http://localhost/mcc");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${MCC_SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    const cookieToken = decodeURIComponent(setCookie.slice(`${MCC_SESSION_COOKIE}=`.length).split(";")[0]);
    const session = verifySessionToken(cookieToken);
    expect(session?.sub).toBe(ADMIN_ID);
    expect(session?.purpose).toBe("mcc");
    expect(db.tables.mcc_magic_tokens[0].used_at).toBeTruthy();

    const replay = await GET(magicRequest(raw));
    expect(locationOf(replay)).toContain("/mcc/login?error=used");
    expect(replay.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an expired token without burning or minting", async () => {
    db.tables.profiles = adminProfile();
    const raw = seedTokenRow(ADMIN_ID, -1000); // DB expired; JWT still signed
    const { GET } = await loadRoute();
    const res = await GET(magicRequest(raw));
    expect(locationOf(res)).toContain("/mcc/login?error=expired");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(db.tables.mcc_magic_tokens[0].used_at).toBeNull();
  });

  it("rejects a validly signed token bound to a non-admin user (and burns it)", async () => {
    db.tables.profiles = [{ id: USER_ID, telegram_id: TG_ID, is_admin: false }];
    const raw = seedTokenRow(USER_ID);
    const { GET } = await loadRoute();
    const res = await GET(magicRequest(raw));
    expect(locationOf(res)).toContain("/mcc/login?error=forbidden");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(db.tables.mcc_magic_tokens[0].used_at).toBeTruthy();
  });

  it("rejects an unsigned/forged token even when a hash row exists", async () => {
    db.tables.profiles = adminProfile();
    const forged = "not-a-jwt";
    db.tables.mcc_magic_tokens = [
      {
        token_hash: hashMccMagicToken(forged),
        user_id: ADMIN_ID,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        used_at: null,
      },
    ];
    const { GET } = await loadRoute();
    const res = await GET(magicRequest(forged));
    expect(locationOf(res)).toContain("/mcc/login?error=invalid");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(db.tables.mcc_magic_tokens[0].used_at).toBeNull();
  });

  it("rejects a signed token with no stored row (DB read alone cannot mint)", async () => {
    db.tables.profiles = adminProfile();
    const raw = signMccMagicToken(ADMIN_ID); // never inserted
    const { GET } = await loadRoute();
    const res = await GET(magicRequest(raw));
    expect(locationOf(res)).toContain("/mcc/login?error=not_found");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a missing token", async () => {
    const { GET } = await loadRoute();
    const res = await GET(magicRequest(null));
    expect(locationOf(res)).toContain("/mcc/login?error=missing");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("never accepts an MCC cookie session value as a magic token", async () => {
    db.tables.profiles = adminProfile();
    const cookie = signSession({ sub: ADMIN_ID, tg: TG_ID, purpose: "mcc" }, 3600);
    const { GET } = await loadRoute();
    const res = await GET(magicRequest(cookie));
    expect(locationOf(res)).toContain("/mcc/login?error=not_found");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Migration 007 — static review (never executed here, permanent rule 11)
// ---------------------------------------------------------------------------

describe("007_mcc_magic_tokens.sql (static)", () => {
  const sql = readFileSync("supabase/migrations/007_mcc_magic_tokens.sql", "utf8");

  it("records the next schema version (0009) and stays idempotent", () => {
    expect(sql).toContain("create table if not exists public.mcc_magic_tokens");
    expect(sql).toContain("'0009-mcc-magic-tokens'");
    expect(sql).toContain("on conflict (version) do nothing");
    expect(sql).toContain("create index if not exists idx_mcc_magic_tokens_expires_at");
  });

  it("stores only the token hash plus one-time-claim bookkeeping", () => {
    expect(sql).toContain("token_hash text primary key");
    expect(sql).toMatch(/used_at\s+timestamptz/);
    expect(sql).toMatch(/expires_at\s+timestamptz/);
    expect(sql).not.toMatch(/raw_token|\btoken\s+text/i);
  });

  it("binds tokens to profiles and locks the table to service_role", () => {
    expect(sql).toContain("references public.profiles (id)");
    expect(sql).toContain("enable row level security");
    expect(sql).toMatch(/grant select, insert, update, delete on public\.mcc_magic_tokens to service_role/);
  });

  it("never performs destructive DDL/DML", () => {
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate/i);
    expect(sql).not.toMatch(/delete\s+from/i);
  });
});
