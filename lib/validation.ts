/**
 * Small, dependency-free input validators shared by API routes. Everything the
 * client sends is treated as untrusted and validated before it reaches the
 * database or reward RPCs.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BEP20_RE = /^0x[a-fA-F0-9]{40}$/;
const TON_RE = /^(?:EQ|UQ|0:)?[A-Za-z0-9_-]{46,64}={0,2}$/;

export type Network = "BEP20" | "TON";

export const NETWORKS: readonly Network[] = ["BEP20", "TON"];

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isNetwork(value: unknown): value is Network {
  return value === "BEP20" || value === "TON";
}

/** Upper bound guards against absurd client-supplied withdrawal amounts. */
export const MAX_WITHDRAWAL_USDT = 100_000;

export function isValidAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_WITHDRAWAL_USDT
  );
}

export function isValidAddress(network: Network, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return false;
  return network === "BEP20" ? BEP20_RE.test(trimmed) : TON_RE.test(trimmed);
}

/** Referral codes are short alphanumeric tokens. */
export function isValidReferralCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{3,32}$/.test(value);
}

/** Clamp a string to a maximum length (returns null when not a string). */
export function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

/** Return an integer within [min, max], or null when out of range / not numeric. */
export function boundedInt(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < min || i > max) return null;
  return i;
}

/** Return a number within [min, max], or null when out of range / not numeric. */
export function boundedNumber(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** Accept only http(s) URLs. Returns null for anything else. */
export function validHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export const WITHDRAWAL_STATUSES = ["pending", "processing", "paid", "rejected"] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export function isWithdrawalStatus(value: unknown): value is WithdrawalStatus {
  return typeof value === "string" && (WITHDRAWAL_STATUSES as readonly string[]).includes(value);
}
