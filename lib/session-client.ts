/**
 * Lightweight client-side holder for the Questify session token minted by
 * `/api/telegram-auth`, plus the raw Telegram `initData` string. Kept out of
 * React state so the data layer can read them without prop-drilling. Never
 * persisted anywhere durable.
 */
let sessionToken: string | null = null;
let initDataRaw: string | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function getSessionToken(): string | null {
  return sessionToken;
}

export function setInitData(value: string | null): void {
  initDataRaw = value;
}

export function getInitData(): string | null {
  return initDataRaw;
}

/** Headers required by every guarded API route. */
export function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  if (initDataRaw) headers["X-Telegram-Init-Data"] = initDataRaw;
  return headers;
}
