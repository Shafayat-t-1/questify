import { describe, expect, it } from "vitest";
import { resolveReferralCode } from "@/lib/referral";

describe("resolveReferralCode", () => {
  it("prefers initData start_param", () => {
    expect(
      resolveReferralCode({
        initDataStartParam: "FROMINIT",
        href: "https://example.com/?ref=FROMREF",
      }),
    ).toBe("FROMINIT");
  });

  it("reads tgWebAppStartParam from the URL query when start_param is absent", () => {
    expect(
      resolveReferralCode({
        initDataStartParam: null,
        href: "https://example.com/?tgWebAppStartParam=FROMTG&ref=FROMREF",
      }),
    ).toBe("FROMTG");
  });

  it("reads tgWebAppStartParam from the URL hash", () => {
    expect(
      resolveReferralCode({
        initDataStartParam: null,
        href: "https://example.com/#tgWebAppStartParam=FROMHASH",
      }),
    ).toBe("FROMHASH");
  });

  it("falls back to the ?ref= query param", () => {
    expect(
      resolveReferralCode({
        initDataStartParam: null,
        href: "https://example.com/app?ref=FROMREF",
      }),
    ).toBe("FROMREF");
  });

  it("returns null when no source provides a code", () => {
    expect(resolveReferralCode({ initDataStartParam: null, href: "https://example.com/" })).toBeNull();
    expect(resolveReferralCode({ initDataStartParam: "", href: null })).toBeNull();
    expect(resolveReferralCode({})).toBeNull();
  });

  it("ignores blank/whitespace-only values", () => {
    expect(
      resolveReferralCode({ initDataStartParam: "   ", href: "https://example.com/?ref=REAL" }),
    ).toBe("REAL");
  });

  it("does not throw on an unparseable URL", () => {
    expect(resolveReferralCode({ initDataStartParam: null, href: "not a url" })).toBeNull();
  });
});
