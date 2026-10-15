/**
 * Idempotency keys for money-adjacent mutations (withdrawals, task claims).
 *
 * The client generates one key per user intent and reuses it across retries of
 * that same intent, so a double tap / network retry can never double-credit or
 * double-debit: the database RPCs treat a repeated key as a replay and return
 * the original result. Keys are opaque, URL-safe and length-bounded.
 */

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && KEY_RE.test(value);
}

/** Generate a fresh idempotency key (crypto.randomUUID with a safe fallback). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
