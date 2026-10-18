import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdmin } from "./helpers/fake-admin";
import { invalidateSettingsCache } from "@/lib/settings";
import { signSession } from "@/lib/session";

/**
 * Phase 4A OAuth linking tests — the real HTTP contract of
 *   GET /api/oauth/[provider]/start
 *   GET /api/oauth/[provider]/callback
 *
 * In-memory FakeAdmin + mocked provider fetches; no real network, no real
 * database (permanent rule 11). Provider tokens are never persisted: the only
 * write asserted is connected_accounts (stable external id + username).
 */

const holder = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => holder.admin,
  isSupabaseConfigured: Boolean(holder.admin),
  supabase: null,
}));

const APP_URL = "http://localhost:3000";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

let db: FakeAdmin;
let token: string;
let fetchMock: ReturnType<typeof vi.fn>;
const savedEnv: Record<string, string | undefined> = {};

function saveEnv(key: string): void {
  savedEnv[key] = process.env[key];
}
function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resetAdmin(): void {
  db = new FakeAdmin();
  holder.admin = db;
  db.rpcHandler = async (name) =>
    name === "check_rate_limit" ? { data: true, error: null } : { data: null, error: null };
  invalidateSettingsCache();
}

beforeAll(async () => {
  for (const key of ["QUESTIFY_JWT_SECRET", "NEXT_PUBLIC_APP_URL", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "TELEGRAM_BOT_TOKEN", "DEMO_MODE"]) {
    saveEnv(key);
  }
  process.env.QUESTIFY_JWT_SECRET = "test-secret-value-at-least-32-bytes-long!!";
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  process.env.GITHUB_CLIENT_ID = "gh-client-id";
  process.env.GITHUB_CLIENT_SECRET = "gh-client-secret";
  process.env.GOOGLE_CLIENT_ID = "gg-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "gg-client-secret";
  process.env.DISCORD_CLIENT_ID = "dc-client-id";
  process.env.DISCORD_CLIENT_SECRET = "dc-client-secret";
  delete process.env.TELEGRAM_BOT_TOKEN; // authenticateRequest then accepts Bearer-only
  delete process.env.DEMO_MODE;
  token = signSession({ sub: USER_ID });
  // Pay the cold-import cost (next/server etc.) inside the hook, not a test.
  await loadRoute("start");
  await loadRoute("callback");
});

beforeEach(() => {
  // Re-assert env every test: individual tests may mutate it (and process.env
  // is shared state across the whole file).
  process.env.QUESTIFY_JWT_SECRET = "test-secret-value-at-least-32-bytes-long!!";
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  process.env.GITHUB_CLIENT_ID = "gh-client-id";
  process.env.GITHUB_CLIENT_SECRET = "gh-client-secret";
  process.env.GOOGLE_CLIENT_ID = "gg-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "gg-client-secret";
  process.env.DISCORD_CLIENT_ID = "dc-client-id";
  process.env.DISCORD_CLIENT_SECRET = "dc-client-secret";
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.DEMO_MODE;
  resetAdmin();
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("github.com/login/oauth/access_token")) return jsonRes({ access_token: "tok-gh-1" });
    if (u.includes("api.github.com/user")) return jsonRes({ id: 4242, login: "octocat" });
    return jsonRes({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  holder.admin = null;
  invalidateSettingsCache();
});

afterAll(() => {
  restoreEnv();
});

// ---------------------------------------------------------------------------
// Route helpers (dynamic imports resolve after beforeAll configures the env)
// ---------------------------------------------------------------------------

async function loadRoute(kind: "start" | "callback") {
  if (kind === "start") return import("@/app/api/oauth/[provider]/start/route");
  return import("@/app/api/oauth/[provider]/callback/route");
}

async function start(provider: string, auth = `Bearer ${token}`): Promise<Response> {
  const { GET } = await loadRoute("start");
  const request = new Request(`${APP_URL}/api/oauth/${provider}/start`, {
    method: "GET",
    headers: auth ? { Authorization: auth } : {},
  });
  return GET(request, { params: Promise.resolve({ provider }) });
}

async function callback(provider: string, search: string): Promise<Response> {
  const { GET } = await loadRoute("callback");
  const request = new Request(`${APP_URL}/api/oauth/${provider}/callback${search}`, {
    method: "GET",
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
  return GET(request, { params: Promise.resolve({ provider }) });
}

/** Run the start route and return the raw `state` from the consent URL. */
async function createState(provider = "github"): Promise<string> {
  const res = await start(provider);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { ok: boolean; authorizeUrl: string };
  expect(json.ok).toBe(true);
  const url = new URL(json.authorizeUrl);
  const state = url.searchParams.get("state");
  expect(state).toBeTruthy();
  return state!;
}

function locationParams(res: Response): URLSearchParams {
  expect([301, 302, 307, 308]).toContain(res.status);
  const location = res.headers.get("location")!;
  expect(location.startsWith(`${APP_URL}/oauth/result`)).toBe(true);
  return new URL(location).searchParams;
}

// ---------------------------------------------------------------------------
// /start
// ---------------------------------------------------------------------------

describe("GET /api/oauth/[provider]/start", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await start("github", "");
    expect(res.status).toBe(401);
    expect(db.tables.oauth_states ?? []).toHaveLength(0);
  });

  it("404s an unknown provider", async () => {
    const res = await start("snapchat");
    expect(res.status).toBe(404);
  });

  it("503s a provider with no configured credentials", async () => {
    delete process.env.GITHUB_CLIENT_ID;
    const res = await start("github");
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("provider_not_configured");
  });

  it("returns the consent URL and stores ONLY the state's hash", async () => {
    const res = await start("github");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; authorizeUrl: string };
    expect(json.ok).toBe(true);

    const url = new URL(json.authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("gh-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP_URL}/api/oauth/github/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const state = url.searchParams.get("state")!;

    const rows = db.tables.oauth_states ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].state_hash).toBe(createHash("sha256").update(state).digest("hex"));
    expect(rows[0].state_hash).not.toBe(state);
    expect(rows[0].user_id).toBe(USER_ID);
    expect(rows[0].provider).toBe("github");
    expect(rows[0].consumed_at ?? null).toBeNull();
    // No provider token exists at this point — nothing to persist, by design.
    expect(Object.keys(rows[0])).not.toContain("access_token");
  });

  it("429s when the operator-tuned limiter says stop", async () => {
    db.rpcHandler = async (name) =>
      name === "check_rate_limit" ? { data: false, error: null } : { data: null, error: null };
    const res = await start("github");
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("rate_limited");
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// /callback
// ---------------------------------------------------------------------------

describe("GET /api/oauth/[provider]/callback", () => {
  it("links the GitHub identity and discards the provider token", async () => {
    const state = await createState();
    const res = await callback("github", `?code=auth-code&state=${encodeURIComponent(state)}`);
    const params = locationParams(res);
    expect(params.get("provider")).toBe("github");
    expect(params.get("status")).toBe("linked");

    const rows = db.tables.connected_accounts ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: USER_ID,
      provider: "github",
      provider_user_id: "4242",
      username: "octocat",
    });
    // Token exchange happened server-to-server; the token itself is nowhere
    // in our database.
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://github.com/login/oauth/access_token");
    expect(JSON.stringify(db.tables)).not.toContain("tok-gh-1");
    // State is now consumed (single-use).
    expect(db.tables.oauth_states?.[0].consumed_at).toBeTruthy();
  });

  it("rejects a callback with no state before contacting the provider", async () => {
    const res = await callback("github", "?code=auth-code");
    const params = locationParams(res);
    expect(params.get("status")).toBe("rejected");
    expect(params.get("reason")).toBe("state");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown or already-consumed state (replay guard)", async () => {
    const state = await createState();
    const first = await callback("github", `?code=auth-code&state=${encodeURIComponent(state)}`);
    expect(locationParams(first).get("status")).toBe("linked");

    const replay = await callback("github", `?code=auth-code&state=${encodeURIComponent(state)}`);
    const params = locationParams(replay);
    expect(params.get("status")).toBe("rejected");
    expect(params.get("reason")).toBe("state");
    // The replay never re-runs the token exchange.
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 exchange + 1 profile for the first call only
  });

  it("rejects a state issued for a different provider", async () => {
    const state = await createState("github");
    const res = await callback("google", `?code=auth-code&state=${encodeURIComponent(state)}`);
    const params = locationParams(res);
    expect(params.get("status")).toBe("rejected");
    expect(params.get("reason")).toBe("state");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an expired state", async () => {
    const state = await createState();
    db.tables.oauth_states![0].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await callback("github", `?code=auth-code&state=${encodeURIComponent(state)}`);
    const params = locationParams(res);
    expect(params.get("status")).toBe("rejected");
    expect(params.get("reason")).toBe("state");
  });

  it("passes through a user-initiated cancellation (error=access_denied)", async () => {
    const state = await createState();
    const res = await callback("github", `?error=access_denied&state=${encodeURIComponent(state)}`);
    const params = locationParams(res);
    expect(params.get("status")).toBe("rejected");
    expect(params.get("reason")).toBe("denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing code with a valid state", async () => {
    const state = await createState();
    const res = await callback("github", `?state=${encodeURIComponent(state)}`);
    const params = locationParams(res);
    expect(params.get("status")).toBe("rejected");
    expect(params.get("reason")).toBe("code");
  });

  it("refuses an identity already linked to a DIFFERENT user", async () => {
    db.tables.connected_accounts = [
      { user_id: OTHER_ID, provider: "github", provider_user_id: "4242", username: "octocat" },
    ];
    const state = await createState();
    const res = await callback("github", `?code=auth-code&state=${encodeURIComponent(state)}`);
    const params = locationParams(res);
    expect(params.get("status")).toBe("rejected");
    expect(params.get("reason")).toBe("identity_taken");
    // The existing holder's row is untouched; no upsert happened.
    expect(db.tables.connected_accounts).toHaveLength(1);
    expect(db.tables.connected_accounts![0].user_id).toBe(OTHER_ID);
  });

  it("lets the SAME user re-link the same provider (row replaced, not duplicated)", async () => {
    db.tables.connected_accounts = [
      { user_id: USER_ID, provider: "github", provider_user_id: "4242", username: "old-handle" },
    ];
    const state = await createState();
    const res = await callback("github", `?code=auth-code&state=${encodeURIComponent(state)}`);
    expect(locationParams(res).get("status")).toBe("linked");
    expect(db.tables.connected_accounts).toHaveLength(1);
    expect(db.tables.connected_accounts![0].username).toBe("octocat");
  });

  it("surfaces a provider token-exchange failure as an error result", async () => {
    fetchMock = vi.fn(async () => jsonRes({ error: "bad_verification_code" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    const state = await createState();
    const res = await callback("github", `?code=auth-code&state=${encodeURIComponent(state)}`);
    const params = locationParams(res);
    expect(params.get("status")).toBe("error");
    expect(params.get("reason")).toBe("exchange_failed");
    expect(db.tables.connected_accounts ?? []).toHaveLength(0);
  });

  it("503s when the provider credentials vanished between start and callback", async () => {
    const state = await createState();
    delete process.env.GITHUB_CLIENT_SECRET;
    const res = await callback("github", `?code=auth-code&state=${encodeURIComponent(state)}`);
    const params = locationParams(res);
    expect(params.get("status")).toBe("error");
    expect(params.get("reason")).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429s per-IP when the limiter trips", async () => {
    db.rpcHandler = async (name) =>
      name === "check_rate_limit" ? { data: false, error: null } : { data: null, error: null };
    const res = await callback("github", "?code=auth-code&state=whatever");
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
