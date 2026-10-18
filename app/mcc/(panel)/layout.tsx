import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadMccAdminProfile, verifyMccToken } from "@/lib/mcc-auth";
import { MCC_SESSION_COOKIE } from "@/lib/session";
import { MccIdentityProvider } from "@/components/mcc/MccIdentity";

export const metadata = {
  title: "Questify · Master Control Center",
  robots: { index: false, follow: false },
};

// Auth gating reads cookies() at request time — there is no useful static
// shell for this segment (Next.js 16 instant-navigation validation).
export const instant = false;

/**
 * Server-side gate for every page under the control center. There is no
 * client-side-only protection anywhere in /mcc: no valid, fresh, MCC-scoped
 * cookie whose profile row carries `is_admin = true` ⇒ redirect to login.
 */
export default async function MccPanelLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const payload = verifyMccToken(store.get(MCC_SESSION_COOKIE)?.value ?? null);
  const context = payload ? await loadMccAdminProfile(payload.sub) : null;
  if (!context) redirect("/mcc/login");

  return (
    <MccIdentityProvider
      value={{
        username: context.username,
        telegramId: context.telegramId,
        isFounder: context.isFounder,
      }}
    >
      {children}
    </MccIdentityProvider>
  );
}
