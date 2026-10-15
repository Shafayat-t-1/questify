/**
 * Shared client-side fetcher for the /mcc control center.
 *
 * Authentication travels exclusively in the httpOnly `questify_mcc` cookie
 * (same-origin fetch includes it automatically), so unlike the Mini App's
 * `authHeaders()` there is NO Authorization / initData header here — the
 * standalone browser never holds those. Every privileged route it talks to
 * (`/api/admin`, `/api/mcc/live`) verifies the cookie server-side first.
 */
export interface AdminFetchResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function adminFetch<T>(
  path: string,
  init?: RequestInit & { body?: string },
): Promise<AdminFetchResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (res.status === 401 || res.status === 403) {
      // Session expired or revoked while the tab was open — bounce to login.
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/mcc/login")) {
        window.location.assign("/mcc/login");
      }
      return { ok: false, error: "unauthorized" };
    }
    return (await res.json()) as AdminFetchResult<T>;
  } catch {
    return { ok: false, error: "network_error" };
  }
}
