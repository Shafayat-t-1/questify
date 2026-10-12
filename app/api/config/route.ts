import { NextResponse } from "next/server";
import { envConfig, type PublicConfig } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Public runtime configuration. Base values come from build-time env vars; a row
 * in `platform_settings` (public keys only) can override them at runtime so the
 * brand / bot can be switched without a redeploy and without touching user data.
 */
export async function GET() {
  const base = envConfig();
  const admin = getSupabaseAdmin();

  if (!admin) {
    return NextResponse.json({ ok: true, data: base });
  }

  try {
    const { data } = await admin
      .from("platform_settings")
      .select("key, value")
      .eq("is_public", true);

    const overrides: Partial<PublicConfig> = {};
    for (const row of data ?? []) {
      const value = (row as { value: unknown }).value;
      switch ((row as { key: string }).key) {
        case "brand_name":
          if (typeof value === "string") overrides.brandName = value;
          break;
        case "bot_username":
          if (typeof value === "string") overrides.botUsername = value;
          break;
        case "app_url":
          if (typeof value === "string") overrides.appUrl = value;
          break;
        case "min_withdrawal_usdt":
          if (typeof value === "number") overrides.minWithdrawalUsdt = value;
          break;
        case "support_username":
          overrides.supportUsername = typeof value === "string" ? value : null;
          break;
      }
    }

    return NextResponse.json({
      ok: true,
      data: { ...base, ...overrides } satisfies PublicConfig,
    });
  } catch (err) {
    console.error("[questify] config error", err);
    return NextResponse.json({ ok: true, data: base });
  }
}
