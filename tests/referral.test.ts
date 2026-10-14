import { describe, expect, it } from "vitest";
import { parseReferralCode, resolveReferralCode } from "@/lib/referral";

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

describe("parseReferralCode", () => {
  it("parses a plain uppercase code", () => {
    expect(parseReferralCode("0CC06D6D")).toEqual({ code: "0CC06D6D", suffix: null });
  });

  it("is case-insensitive and trims", () => {
    expect(parseReferralCode("  0cc06d6d  ")).toEqual({ code: "0CC06D6D", suffix: null });
  });

  it("splits a CODE_suffix provenance tag", () => {
    expect(parseReferralCode("0cc06d6d_tt")).toEqual({ code: "0CC06D6D", suffix: "TT" });
  });

  it("rejects malformed / over-long input", () => {
    expect(parseReferralCode("")).toBeNull();
    expect(parseReferralCode("ab")).toBeNull();
    expect(parseReferralCode("bad code!")).toBeNull();
    expect(parseReferralCode("A".repeat(33))).toBeNull();
    expect(parseReferralCode("A".repeat(64))).toBeNull();
  });
});
