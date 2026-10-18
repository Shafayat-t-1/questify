import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";
import {
  appBaseUrl,
  consumeOauthState,
  exchangeCodeForToken,
  fetchProviderProfile,
  isOAuthProvider,
  oauthCredentials,
} from "@/lib/oauth";

/**
 * GET /api/oauth/[provider]/callback
 *
 * OAuth 2.0 redirect target. This is a top-level browser navigation, so it
 * carries NO session headers — identity comes exclusively from the single-use
 * CSRF state created by /start (validated against oauth_states, where only
 * the state's SHA-256 hash is stored).
 *
 * On completion the user is redirected to /oauth/result with a status +
 * non-sensitive reason; tokens are used once for the profile fetch and are
 * NEVER persisted. Only the stable external id + username are written to
 * connected_accounts, and only if that identity is not already linked to a
 * DIFFERENT questify user.
 */

type Status = "linked" | "rejected" | "error";

function resultResponse(provider: string, status: Status, reason: string): NextResponse {
  const base = appBaseUrl();
  if (!base) {
    // Cannot send the browser anywhere sensible — surface JSON instead.
    return NextResponse.json({ ok: false, error: reason }, { status: 503 });
  }
  const url = new URL(`${base}/oauth/result`);
  url.searchParams.set("provider", provider);
  url.searchParams.set("status", status);
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url.toString());
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isOAuthProvider(provider)) {
    return NextResponse.json({ ok: false, error: "unknown_provider" }, { status: 404 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return resultResponse(provider, "error", "not_configured");

  // Rate limit per caller IP before any token work (platform_settings `oauth`).
  const outcome = await checkRateLimit(admin, "oauth", clientIp(request));
  if (!outcome.allowed) return rateLimitedResponse(outcome);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  // CSRF guard first: no state → never touch the provider, regardless of what
  // else the query string claims.
  if (!state) return resultResponse(provider, "rejected", "state");
  const consumed = await consumeOauthState(admin, provider, state);
  if (!consumed) return resultResponse(provider, "rejected", "state");

  // The user cancelled/declined on the consent screen.
  if (providerError) return resultResponse(provider, "rejected", "denied");
  if (!code) return resultResponse(provider, "rejected", "code");

  if (!oauthCredentials(provider)) return resultResponse(provider, "error", "not_configured");

  // Token exchange + one-shot profile fetch. Access tokens are discarded here.
  let profile: Awaited<ReturnType<typeof fetchProviderProfile>>;
  try {
    const accessToken = await exchangeCodeForToken(provider, code, consumed.codeVerifier);
    profile = await fetchProviderProfile(provider, accessToken);
  } catch (err) {
    console.error("[questify] oauth callback failed", err);
    return resultResponse(provider, "error", "exchange_failed");
  }

  // One external identity may be linked to at most ONE questify user.
  const existing = await admin
    .from("connected_accounts")
    .select("user_id")
    .eq("provider", provider)
    .eq("provider_user_id", profile.providerUserId)
    .maybeSingle();
  if (existing.error) return resultResponse(provider, "error", "lookup_failed");
  const holder = existing.data as { user_id?: string } | null;
  if (holder && holder.user_id !== consumed.userId) {
    return resultResponse(provider, "rejected", "identity_taken");
  }

  // Re-linking the same provider for the SAME user replaces their row
  // (unique (user_id, provider)); a lost race on the identity index surfaces
  // as a 23505 and is rejected the same way.
  const { error } = await admin.from("connected_accounts").upsert(
    {
      user_id: consumed.userId,
      provider,
      provider_user_id: profile.providerUserId,
      username: profile.username,
    },
    { onConflict: "user_id,provider" },
  );
  if (error) {
    console.error("[questify] oauth account link failed", error);
    return resultResponse(provider, "error", "link_failed");
  }

  return resultResponse(provider, "linked", "ok");
}
