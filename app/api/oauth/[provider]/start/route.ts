import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import {
  appBaseUrl,
  createOauthState,
  isOAuthProvider,
  oauthCredentials,
} from "@/lib/oauth";

/**
 * GET /api/oauth/[provider]/start
 *
 * Starts a real OAuth 2.0 (authorization code + PKCE) linking flow for
 * Google / GitHub / Discord. Authenticates the Mini App session, rate-limits,
 * stores a single-use CSRF state bound to that user, and returns the
 * provider's consent-screen URL for the client to navigate to.
 *
 * NOTE: this returns JSON `{ authorizeUrl }` rather than a bare 302. The Mini
 * App holds its session as an in-memory bearer token (+ initData header), so a
 * plain browser navigation to this route carries no credentials and could not
 * be authenticated. The client fetches this route (headers attached) and then
 * performs the redirect — the user still ends up on the provider's consent
 * screen exactly as if the server had redirected.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isOAuthProvider(provider)) {
    return NextResponse.json({ ok: false, error: "unknown_provider" }, { status: 404 });
  }

  const auth = authenticateRequest(request);
  if (!auth.ok) return auth.response;

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  if (!oauthCredentials(provider)) {
    return NextResponse.json({ ok: false, error: "provider_not_configured" }, { status: 503 });
  }
  if (!appBaseUrl()) {
    return NextResponse.json({ ok: false, error: "app_url_not_configured" }, { status: 503 });
  }

  // Rate limit: 10 flow starts per user+provider per minute (platform_settings).
  const outcome = await checkRateLimit(admin, "oauth", `${provider}:${auth.context.userId}`);
  if (!outcome.allowed) return rateLimitedResponse(outcome);

  const created = await createOauthState(admin, auth.context.userId, provider);
  if (!created) {
    return NextResponse.json({ ok: false, error: "state_create_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, authorizeUrl: created.authorizeUrl });
}
