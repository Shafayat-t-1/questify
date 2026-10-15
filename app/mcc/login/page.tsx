import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { envConfig } from "@/lib/config";
import { loadMccAdminProfile, verifyMccToken } from "@/lib/mcc-auth";
import { MCC_SESSION_COOKIE } from "@/lib/session";
import { LoginWidget } from "@/components/mcc/LoginWidget";

export const instant = false;

/**
 * Public entry point of the control center. Already-authenticated admins are
 * bounced straight to /mcc; everyone else sees the official Telegram Login
 * Widget (verification happens server-side in /api/mcc-auth, never here).
 */
export default async function MccLoginPage() {
  const store = await cookies();
  const payload = verifyMccToken(store.get(MCC_SESSION_COOKIE)?.value ?? null);
  if (payload) {
    const context = await loadMccAdminProfile(payload.sub);
    if (context) redirect("/mcc");
  }

  const config = envConfig();
  return <LoginWidget botUsername={config.botUsername} brandName={config.brandName} />;
}
