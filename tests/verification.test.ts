import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdmin } from "./helpers/fake-admin";
import { parseGitHubRepoTarget, verifyTask, type VerifiableTask } from "@/lib/verification";

/**
 * Phase 4A verification tests: telegram membership/boost (Bot API) and GitHub
 * star/fork (public API, OAuth-linked account). All network I/O is mocked;
 * nothing here talks to a real provider or database (permanent rule 11).
 *
 * The honesty rules under test:
 *   - a task WITH a verification type never falls back to timer-only;
 *   - unconfigured/unreachable checks fail CLOSED with a clear reason;
 *   - github_* without a linked account says "link first", never "not starred".
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const BOT_TOKEN = "123456:TEST-BOT-TOKEN-for-verification";

let db: FakeAdmin;
let fetchMock: ReturnType<typeof vi.fn>;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function task(partial: Partial<VerifiableTask> = {}): VerifiableTask {
  return {
    id: TASK_ID,
    platform: "telegram",
    verification_type: null,
    verification_target: null,
    verification_rules: null,
    ...partial,
  };
}

beforeEach(() => {
  db = new FakeAdmin();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.GITHUB_TOKEN;
});

async function verify(t: VerifiableTask, telegramId: number | null = 424242) {
  return verifyTask({ task: t, userId: USER_ID, telegramId, admin: db as never });
}

// ---------------------------------------------------------------------------
// Time-gate-only and misconfiguration
// ---------------------------------------------------------------------------

describe("verifyTask — no / time-gate types", () => {
  it("passes none/timer/empty without touching the network", async () => {
    for (const v of [null, "", "none", "timer", " NONE "]) {
      const res = await verify(task({ verification_type: v as string | null }));
      expect(res).toEqual({ ok: true });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown verification type instead of paying out", async () => {
    const res = await verify(task({ verification_type: "snapchat_follow" }));
    expect(res).toEqual({ ok: false, reason: "unsupported_verification" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Telegram membership (telegram_join and aliases)
// ---------------------------------------------------------------------------

describe("verifyTask — telegram_join", () => {
  it("fails closed when TELEGRAM_BOT_TOKEN is missing (no silent timer fallback)", async () => {
    const res = await verify(task({ verification_type: "telegram_join", verification_target: "@chan" }));
    expect(res).toEqual({ ok: false, reason: "verification_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with a missing chat target", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    const res = await verify(task({ verification_type: "telegram_join", verification_target: "  " }));
    expect(res).toEqual({ ok: false, reason: "task_misconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a telegram id even with a bot token", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    const res = await verify(task({ verification_type: "telegram_join", verification_target: "@chan" }), null);
    expect(res).toEqual({ ok: false, reason: "telegram_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts member / administrator / creator", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    for (const status of ["member", "administrator", "creator"]) {
      fetchMock.mockResolvedValueOnce(jsonRes({ ok: true, result: { status } }));
      const res = await verify(task({ verification_type: "telegram_join", verification_target: "@chan" }));
      expect(res).toEqual({ ok: true });
    }
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("getChatMember");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`user_id=424242`);
  });

  it("treats restricted users as members only when is_member is true", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true, result: { status: "restricted", is_member: true } }));
    expect(await verify(task({ verification_type: "telegram_channel", verification_target: "-100123" }))).toEqual({ ok: true });
    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true, result: { status: "restricted", is_member: false } }));
    expect(await verify(task({ verification_type: "telegram_channel", verification_target: "-100123" }))).toEqual({ ok: false, reason: "not_member" });
  });

  it("rejects users who left or were kicked", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    for (const status of ["left", "kicked"]) {
      fetchMock.mockResolvedValueOnce(jsonRes({ ok: true, result: { status } }));
      expect(await verify(task({ verification_type: "telegram_join", verification_target: "@chan" }))).toEqual({
        ok: false,
        reason: "not_member",
      });
    }
  });

  it("maps a Bot API error (bad chat / bot not admin) to verification_error", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    fetchMock.mockResolvedValueOnce(jsonRes({ ok: false, error_code: 400, description: "chat not found" }));
    expect(await verify(task({ verification_type: "telegram_join", verification_target: "@nope" }))).toEqual({
      ok: false,
      reason: "verification_error",
    });
  });

  it("maps a network failure to verification_error (fail closed)", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await verify(task({ verification_type: "telegram_join", verification_target: "@chan" }))).toEqual({
      ok: false,
      reason: "verification_error",
    });
  });
});

// ---------------------------------------------------------------------------
// Telegram boost (getUserChatBoosts)
// ---------------------------------------------------------------------------

describe("verifyTask — telegram_boost", () => {
  it("fails closed without a bot token", async () => {
    const res = await verify(task({ verification_type: "telegram_boost", verification_target: "@chan" }));
    expect(res).toEqual({ ok: false, reason: "verification_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an active boost (expiration in the future)", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    const future = Math.floor(Date.now() / 1000) + 3600;
    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true, result: { boosts: [{ boost_id: "b1", expiration_date: future }] } }));
    const res = await verify(task({ verification_type: "telegram_boost", verification_target: "@chan" }));
    expect(res).toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("getUserChatBoosts");
  });

  it("rejects when every boost has expired", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    const past = Math.floor(Date.now() / 1000) - 10;
    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true, result: { boosts: [{ boost_id: "b1", expiration_date: past }] } }));
    const res = await verify(task({ verification_type: "telegram_boost", verification_target: "@chan" }));
    expect(res).toEqual({ ok: false, reason: "not_boosted" });
  });

  it("rejects a user with no boosts at all", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true, result: { boosts: [] } }));
    const res = await verify(task({ verification_type: "telegram_boost", verification_target: "@chan" }));
    expect(res).toEqual({ ok: false, reason: "not_boosted" });
  });

  it("maps a Bot API failure (bot not admin) to verification_error", async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    fetchMock.mockResolvedValueOnce(jsonRes({ ok: false, error_code: 400 }));
    const res = await verify(task({ verification_type: "telegram_boost", verification_target: "@chan" }));
    expect(res).toEqual({ ok: false, reason: "verification_error" });
  });
});

// ---------------------------------------------------------------------------
// GitHub repo target parsing
// ---------------------------------------------------------------------------

describe("parseGitHubRepoTarget", () => {
  it("accepts owner/repo, full URLs, .git suffixes and trailing slashes", () => {
    expect(parseGitHubRepoTarget("octocat/hello-world")).toEqual({ owner: "octocat", repo: "hello-world" });
    expect(parseGitHubRepoTarget("https://github.com/octocat/hello-world")).toEqual({ owner: "octocat", repo: "hello-world" });
    expect(parseGitHubRepoTarget(" https://github.com/OctoCat/Hello-World.git/ ")).toEqual({
      owner: "OctoCat",
      repo: "Hello-World",
    });
  });

  it("rejects garbage, extra path segments and injection attempts", () => {
    for (const bad of [null, undefined, "", "octocat", "a/b/c", "oct cat/repo", "octocat/re po", "../../etc/passwd"]) {
      expect(parseGitHubRepoTarget(bad as string | null)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// GitHub star / fork verification
// ---------------------------------------------------------------------------

describe("verifyTask — github_star / github_fork", () => {
  it("asks the user to link GitHub first (never 'you didn't star') when no account is linked", async () => {
    const res = await verify(task({ verification_type: "github_star", verification_target: "octocat/hello-world" }));
    expect(res).toEqual({ ok: false, reason: "github_not_linked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a task with a missing/bad repo target (misconfigured, not the user's fault)", async () => {
    db.tables.connected_accounts = [{ user_id: USER_ID, provider: "github", provider_user_id: "42", username: "octocat" }];
    const res = await verify(task({ verification_type: "github_star", verification_target: "not-a-repo" }));
    expect(res).toEqual({ ok: false, reason: "task_misconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a starred repo found on the newest page", async () => {
    db.tables.connected_accounts = [{ user_id: USER_ID, provider: "github", provider_user_id: "42", username: "octocat" }];
    fetchMock.mockResolvedValueOnce(
      jsonRes([
        { full_name: "other/repo" },
        { full_name: "OctoCat/Hello-World" }, // case-insensitive match
      ]),
    );
    const res = await verify(task({ verification_type: "github_star", verification_target: "octocat/hello-world" }));
    expect(res).toEqual({ ok: true });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("api.github.com/users/octocat/starred");
    expect(url).toContain("sort=created");
  });

  it("rejects with not_starred when the list ends without a match", async () => {
    db.tables.connected_accounts = [{ user_id: USER_ID, provider: "github", provider_user_id: "42", username: "octocat" }];
    fetchMock.mockResolvedValueOnce(jsonRes([{ full_name: "other/repo" }]));
    const res = await verify(task({ verification_type: "github_star", verification_target: "octocat/hello-world" }));
    expect(res).toEqual({ ok: false, reason: "not_starred" });
  });

  it("fails closed with verification_inconclusive when the list outgrows the page cap", async () => {
    db.tables.connected_accounts = [{ user_id: USER_ID, provider: "github", provider_user_id: "42", username: "octocat" }];
    const fullPage = Array.from({ length: 100 }, () => ({ full_name: "other/repo" }));
    // A Response body can only be consumed once — build a fresh one per page.
    fetchMock.mockImplementation(async () => jsonRes(fullPage));
    const res = await verify(task({ verification_type: "github_star", verification_target: "octocat/hello-world" }));
    expect(res).toEqual({ ok: false, reason: "verification_inconclusive" });
    expect(fetchMock).toHaveBeenCalledTimes(10); // bounded by GITHUB_MAX_PAGES
  });

  it("maps a GitHub 403/429 (rate limit) to verification_error", async () => {
    db.tables.connected_accounts = [{ user_id: USER_ID, provider: "github", provider_user_id: "42", username: "octocat" }];
    fetchMock.mockResolvedValueOnce(jsonRes({ message: "API rate limit exceeded" }, 403));
    const res = await verify(task({ verification_type: "github_star", verification_target: "octocat/hello-world" }));
    expect(res).toEqual({ ok: false, reason: "verification_error" });
  });

  it("sends the optional GITHUB_TOKEN as a Bearer header when configured", async () => {
    process.env.GITHUB_TOKEN = "ghp_testtoken";
    db.tables.connected_accounts = [{ user_id: USER_ID, provider: "github", provider_user_id: "42", username: "octocat" }];
    fetchMock.mockResolvedValueOnce(jsonRes([]));
    await verify(task({ verification_type: "github_star", verification_target: "octocat/hello-world" }));
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer ghp_testtoken");
    expect(init.headers["X-GitHub-Api-Version"]).toBe("2026-03-10");
  });

  it("accepts a fork found in the repo's fork list (owner login match)", async () => {
    db.tables.connected_accounts = [{ user_id: USER_ID, provider: "github", provider_user_id: "42", username: "octocat" }];
    fetchMock.mockResolvedValueOnce(jsonRes([{ owner: { login: "OctoCat" } }]));
    const res = await verify(task({ verification_type: "github_fork", verification_target: "some/repo" }));
    expect(res).toEqual({ ok: true });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("api.github.com/repos/some/repo/forks");
  });

  it("rejects with not_forked when the fork list ends without the user", async () => {
    db.tables.connected_accounts = [{ user_id: USER_ID, provider: "github", provider_user_id: "42", username: "octocat" }];
    fetchMock.mockResolvedValueOnce(jsonRes([{ owner: { login: "someone-else" } }]));
    const res = await verify(task({ verification_type: "github_fork", verification_target: "some/repo" }));
    expect(res).toEqual({ ok: false, reason: "not_forked" });
  });

  it("treats a missing upstream repo as a misconfigured task (404)", async () => {
    db.tables.connected_accounts = [{ user_id: USER_ID, provider: "github", provider_user_id: "42", username: "octocat" }];
    fetchMock.mockResolvedValueOnce(jsonRes({ message: "Not Found" }, 404));
    const res = await verify(task({ verification_type: "github_fork", verification_target: "gone/repo" }));
    expect(res).toEqual({ ok: false, reason: "task_misconfigured" });
  });

  it("maps a network failure to verification_error", async () => {
    db.tables.connected_accounts = [{ user_id: USER_ID, provider: "github", provider_user_id: "42", username: "octocat" }];
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const res = await verify(task({ verification_type: "github_star", verification_target: "octocat/hello-world" }));
    expect(res).toEqual({ ok: false, reason: "verification_error" });
  });
});

// ---------------------------------------------------------------------------
// account_link (manual providers)
// ---------------------------------------------------------------------------

describe("verifyTask — account_link", () => {
  it("requires a connected_accounts row for the targeted provider", async () => {
    db.tables.connected_accounts = [{ user_id: OTHER_ID, provider: "github", provider_user_id: "9", username: "other" }];
    expect(await verify(task({ verification_type: "account_link", verification_target: "github" }))).toEqual({
      ok: false,
      reason: "account_not_linked",
    });
    db.tables.connected_accounts = [{ user_id: USER_ID, provider: "x", provider_user_id: "9", username: "octocat_x" }];
    expect(await verify(task({ verification_type: "account_link", verification_target: "x" }))).toEqual({ ok: true });
    // legacy alias: bare "twitter" maps to provider "x"
    expect(await verify(task({ verification_type: "twitter" }))).toEqual({ ok: true });
  });

  it("works with a legacy provider-name type and no target", async () => {
    db.tables.connected_accounts = [{ user_id: USER_ID, provider: "youtube", provider_user_id: "c1", username: "chan" }];
    expect(await verify(task({ verification_type: "youtube" }))).toEqual({ ok: true });
    expect(await verify(task({ verification_type: "reddit" }))).toEqual({ ok: false, reason: "account_not_linked" });
  });
});
