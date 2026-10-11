/**
 * Lightweight client-side holder for the Questify session token minted by
 * `/api/telegram-auth`. Kept out of React state so the data layer can read it
 * without prop-drilling. Never persisted anywhere durable.
 */
let sessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function getSessionToken(): string | null {
  return sessionToken;
}
