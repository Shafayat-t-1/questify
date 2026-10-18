import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * OAuth 2.0 authorization-code flow (with PKCE) for real account linking.
 *
 * Endpoints and scopes below were verified against each provider's current
 * developer documentation (Google "Using OAuth 2.0 for Web Server
 * Applications", GitHub "Authorizing OAuth apps", Discord "OAuth2").
 *
 * SECURITY POSTURE:
 *   - Provider access/refresh tokens are NEVER persisted. The token is used
 *     once inside the callback to fetch the minimal profile (stable external
 *     id + username/login) and then discarded. Only that identity is written
 *     to connected_accounts.
 *   - The CSRF `state` is stored as a SHA-256 HASH in oauth_states together
 *     with the PKCE code_verifier, tied to the questify user who started the
 *     flow, single-use (consumed_at) and short-lived (10 minutes).
 *   - Redirect URI is derived from NEXT_PUBLIC_APP_URL and must be registered
 *     with each provider verbatim.
 */

export const OAUTH_PROVIDERS = ["google", "github", "discord"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

interface ProviderEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  /** Space-delimited scope list ("" where the public profile needs no scope). */
  scope: string;
}

const ENDPOINTS: Record<OAuthProvider, ProviderEndpoints> = {
  // Google: accounts.google.com authorization server, OIDC userinfo for the profile.
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
  },
  // GitHub: standard web application flow. Empty scope = read-only public
  // profile (id + login) — the minimum this phase needs.
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "",
  },
  // Discord: API v10. `identify` returns id + username from /users/@me.
  discord: {
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    scope: "identify",
  },
};

const STATE_TTL_SECONDS = 600;

export interface OAuthProfile {
  /** Stable provider-side user id (Google `sub`, GitHub `id`, Discord `id`). */
  providerUserId: string;
  /** Display handle (Google email, GitHub login, Discord username). */
  username: string | null;
}

/** Base URL of the app (no trailing slash), or "" when not configured. */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
}

export function oauthCredentials(
  provider: OAuthProvider,
): { clientId: string; clientSecret: string } | null {
  const prefix = provider.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** The exact redirect URI the operator must register with the provider. */
export function oauthRedirectUri(provider: OAuthProvider): string | null {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/api/oauth/${provider}/callback`;
}

export function oauthStateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Full consent-screen URL for the provider, or null when misconfigured. */
export function buildAuthorizeUrl(
  provider: OAuthProvider,
  state: string,
  codeChallenge: string,
): string | null {
  const creds = oauthCredentials(provider);
  const redirectUri = oauthRedirectUri(provider);
  if (!creds || !redirectUri) return null;

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  const endpoints = ENDPOINTS[provider];

  if (provider === "github") {
    params.set("allow_signup", "true");
    if (endpoints.scope) params.set("scope", endpoints.scope);
  } else {
    params.set("response_type", "code");
    params.set("scope", endpoints.scope);
  }

  return `${endpoints.authorizeUrl}?${params.toString()}`;
}

/**
 * Create a single-use CSRF state bound to `userId` and return the raw state
 * plus the consent-screen URL. The DB only ever sees the state's hash.
 */
export async function createOauthState(
  admin: SupabaseClient,
  userId: string,
  provider: OAuthProvider,
): Promise<{ state: string; authorizeUrl: string } | null> {
  const state = randomBytes(32).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const authorizeUrl = buildAuthorizeUrl(provider, state, challenge);
  if (!authorizeUrl) return null;

  const expiresAt = new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString();
  const { error } = await admin.from("oauth_states").insert({
    state_hash: oauthStateHash(state),
    user_id: userId,
    provider,
    code_verifier: verifier,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[questify] oauth state insert failed", error);
    return null;
  }
  return { state, authorizeUrl };
}

export interface ConsumedState {
  userId: string;
  codeVerifier: string;
}

/**
 * Validate + atomically consume a callback state. Returns null for a missing,
 * wrong-provider, expired, replayed or unknown state (CSRF / replay guard).
 */
export async function consumeOauthState(
  admin: SupabaseClient,
  provider: OAuthProvider,
  state: string,
): Promise<ConsumedState | null> {
  const stateHash = oauthStateHash(state);
  const { data, error } = await admin
    .from("oauth_states")
    .select("user_id, provider, code_verifier, expires_at")
    .eq("state_hash", stateHash)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as {
    user_id: string;
    provider: string;
    code_verifier: string;
    expires_at: string;
  };
  if (row.provider !== provider) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;

  // Single-use: the UPDATE only matches while consumed_at IS NULL, so a
  // replayed callback loses the race and is rejected.
  const consumed = await admin
    .from("oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_hash", stateHash)
    .is("consumed_at", null)
    .select("state_hash");
  if (consumed.error) return null;
  const claimed = Array.isArray(consumed.data) ? consumed.data.length : 0;
  if (claimed !== 1) return null;

  return { userId: row.user_id, codeVerifier: row.code_verifier };
}

/**
 * Exchange the authorization code for tokens (server-to-server) and return
 * the access token. The token is NEVER persisted — callers use it once to
 * fetch the profile and discard it.
 */
export async function exchangeCodeForToken(
  provider: OAuthProvider,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const creds = oauthCredentials(provider);
  const redirectUri = oauthRedirectUri(provider);
  if (!creds || !redirectUri) throw new Error("provider_not_configured");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code_verifier: codeVerifier,
  });

  const res = await fetch(ENDPOINTS[provider].tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // GitHub returns form-encoded bodies unless JSON is requested; Google
      // and Discord return JSON regardless. Discord REQUIRES this content type.
      Accept: "application/json",
    },
    body: body.toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("token_exchange_failed");

  const json = (await res.json().catch(() => null)) as {
    access_token?: string;
    error?: string;
  } | null;
  if (!json || json.error || !json.access_token) throw new Error("token_exchange_failed");
  return json.access_token;
}

/** Fetch the minimal stable profile for the granted identity, then discard it. */
export async function fetchProviderProfile(
  provider: OAuthProvider,
  accessToken: string,
): Promise<OAuthProfile> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  let url: string;
  if (provider === "google") {
    url = "https://openidconnect.googleapis.com/v1/userinfo";
  } else if (provider === "github") {
    url = "https://api.github.com/user";
    headers["X-GitHub-Api-Version"] = "2026-03-10";
  } else {
    url = "https://discord.com/api/v10/users/@me";
  }

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error("profile_fetch_failed");
  const profile = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!profile) throw new Error("profile_fetch_failed");

  if (provider === "google") {
    const sub = typeof profile.sub === "string" ? profile.sub : null;
    if (!sub) throw new Error("profile_fetch_failed");
    const email = typeof profile.email === "string" ? profile.email : null;
    const name = typeof profile.name === "string" ? profile.name : null;
    return { providerUserId: sub, username: email ?? name };
  }
  if (provider === "github") {
    const id = typeof profile.id === "number" ? String(profile.id) : null;
    const login = typeof profile.login === "string" ? profile.login : null;
    if (!id || !login) throw new Error("profile_fetch_failed");
    return { providerUserId: id, username: login };
  }
  const id = typeof profile.id === "string" ? profile.id : null;
  const login = typeof profile.username === "string" ? profile.username : null;
  if (!id || !login) throw new Error("profile_fetch_failed");
  return { providerUserId: id, username: login };
}
