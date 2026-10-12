import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

const VALID_PROVIDERS = ["telegram", "google", "x", "github", "reddit", "discord", "youtube", "tiktok"] as const;

type Provider = (typeof VALID_PROVIDERS)[number];

function isProvider(p: unknown): p is Provider {
  return typeof p === "string" && (VALID_PROVIDERS as readonly string[]).includes(p);
}

function bounded(v: unknown, max = 120): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.ok) return auth.response;

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: true, data: [] });

  const { data, error } = await admin
    .from("connected_accounts")
    .select("provider, provider_user_id, username, connected_at")
    .eq("user_id", auth.context.userId)
    .order("connected_at", { ascending: false });

  if (error) {
    console.error("[questify] accounts error", error);
    return NextResponse.json({ ok: true, data: [] });
  }

  return NextResponse.json({ ok: true, data: data ?? [] });
}

export async function POST(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const provider = body.provider;
  const username = bounded(body.username);
  const profileUrl = bounded(body.profile_url);
  const providerUserId = bounded(body.provider_user_id);

  if (!isProvider(provider)) {
    return NextResponse.json({ ok: false, error: "invalid_provider" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  try {
    await admin
      .from("connected_accounts")
      .upsert(
        {
          user_id: auth.context.userId,
          provider,
          provider_user_id: providerUserId,
          username: username ?? (profileUrl ? profileUrl.slice(0, 40) : null),
        },
        { onConflict: "user_id,provider" },
      );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[questify] link account failed", err);
    return NextResponse.json({ ok: false, error: "link_failed" }, { status: 500 });
  }
}
