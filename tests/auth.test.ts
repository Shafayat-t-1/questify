import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The auth route must fail closed: with no `TELEGRAM_BOT_TOKEN` it returns 500
 * and never mints a session, regardless of DEMO_MODE.
 */
describe("POST /api/telegram-auth (fail-closed)", () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalDemo = process.env.DEMO_MODE;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalDemo === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemo;
    vi.resetModules();
  });

  function authRequest(initData: string): Request {
    return new Request("http://localhost/api/telegram-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });
  }

  it("returns 500 and mints no session when the bot token is missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.DEMO_MODE;

    const { POST } = await import("@/app/api/telegram-auth/route");
    const res = await POST(authRequest("user=%7B%22id%22%3A1%7D&hash=deadbeef"));

    expect(res.status).toBe(500);
    const json = (await res.json()) as { ok: boolean; token?: string };
    expect(json.ok).toBe(false);
    expect(json.token).toBeUndefined();
  });

  it("still returns 500 when DEMO_MODE is on but the bot token is missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    process.env.DEMO_MODE = "true";

    const { POST } = await import("@/app/api/telegram-auth/route");
    const res = await POST(authRequest("user=%7B%22id%22%3A1%7D&hash=deadbeef"));

    expect(res.status).toBe(500);
    const json = (await res.json()) as { ok: boolean; token?: string };
    expect(json.ok).toBe(false);
    expect(json.token).toBeUndefined();
  });

  it("rejects a request with no initData before doing any crypto", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "unused-in-this-test";

    const { POST } = await import("@/app/api/telegram-auth/route");
    const res = await POST(authRequest(""));

    expect(res.status).toBe(400);
  });
});
