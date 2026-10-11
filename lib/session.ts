import { createHmac, timingSafeEqual } from "node:crypto";

const JWT_SECRET =
  process.env.QUESTIFY_JWT_SECRET ??
  process.env.SUPABASE_JWT_SECRET ??
  "questify-dev-secret-change-me";

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

/** Mint a minimal HS256 session token (verified by `verifySessionToken`). */
export function signSession(
  payload: SessionPayload,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(
    JSON.stringify({
      ...payload,
      iat: payload.iat ?? now,
      exp: payload.exp ?? now + ttlSeconds,
    }),
  );
  const sig = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

/** Verify a session token's signature and expiry. Returns the payload or null. */
export function verifySessionToken(
  token: string | null | undefined,
): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const expected = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(decodeBase64url(body)) as SessionPayload;
    if (!payload.sub) return null;
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
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
