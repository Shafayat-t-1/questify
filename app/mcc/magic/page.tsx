import { redirect } from "next/navigation";

export const instant = false;

/**
 * Target of the bot-issued magic link (`/mcc/magic?token=...`). A page cannot
 * set cookies, so it hands the token straight to the redemption route, which
 * verifies it, burns it and mints the MCC session cookie server-side.
 */
export default async function MccMagicPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect("/mcc/login?error=missing");
  redirect(`/api/mcc-magic?token=${encodeURIComponent(token)}`);
}
