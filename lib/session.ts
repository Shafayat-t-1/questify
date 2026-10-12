import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-only session signing.
 *
 * The signing key is REQUIRED to be a high-entropy secret of at least 32 bytes.
 * There is intentionally NO fallback: if `QUESTIFY_JWT_SECRET` is missing or too
 * weak the server fails closed (minting throws, verification rejects every
 * token) rather than silently signing with a guessable default.
 *
 * Generate one with:  openssl rand -hex 32
 */
const MIN_SECRET_BYTES = 32;

/** Secrets that must never be accepted even if they somehow reach production. */
const FORBIDDEN_SECRETS = new Set([
  "questify-dev-secret-change-me",
  "questify-local-dev-secret",
  "changeme",
  "secret",
  "password",
]);

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionPayload {
  sub: string;
  tg?: number;
  demo?: boolean;
  iat?: number;
  exp?: number;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function decodeBase64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

/**
 * Read and validate the signing secret. Throws unless a sufficiently strong
 * secret is configured. Called lazily so a misconfiguration fails at request
 * time (denying traffic) instead of at build time.
 */
function requireSecret(): Buffer {
  const raw = (process.env.QUESTIFY_JWT_SECRET ?? process.env.SUPABASE_JWT_SECRET ?? "").trim();
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes < MIN_SECRET_BYTES || FORBIDDEN_SECRETS.has(raw)) {
    throw new Error(
      `QUESTIFY_JWT_SECRET is required to sign sessions and must be a random secret of at ` +
        `least ${MIN_SECRET_BYTES} bytes (configured length: ${bytes} bytes). There is no ` +
        `fallback secret. Generate one with: openssl rand -hex 32`,
    );
  }
  return Buffer.from(raw, "utf8");
}

/** Mint a minimal HS256 session token (verified by `verifySessionToken`). */
export function signSession(
  payload: SessionPayload,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const secret = requireSecret();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(
    JSON.stringify({
      ...payload,
      iat: payload.iat ?? now,
      exp: payload.exp ?? now + ttlSeconds,
    }),
  );
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

/** Verify a session token's signature and expiry. Returns the payload or null. */
export function verifySessionToken(
  token: string | null | undefined,
): SessionPayload | null {
  if (!token) return null;

  let secret: Buffer;
  try {
    secret = requireSecret();
  } catch {
    // Misconfigured / weak secret ⇒ reject everything (fail closed).
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const decoded = JSON.parse(decodeBase64url(body)) as SessionPayload;
    if (!decoded.sub) return null;
    if (typeof decoded.exp === "number" && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/** Extract a bearer token from an incoming request's Authorization header. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
