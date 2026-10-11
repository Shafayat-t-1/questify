"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * Minimal, dependency-free typings for the Telegram WebApp SDK
 * (https://telegram.org/js/telegram-web-app.js).
 */
export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

export interface TelegramWebAppInitData {
  query_id?: string;
  user?: TelegramWebAppUser;
  receiver?: TelegramWebAppUser;
  start_param?: string;
  auth_date?: number;
  hash?: string;
}

export interface TelegramHapticFeedback {
  impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
  notificationOccurred: (type: "error" | "success" | "warning") => void;
  selectionChanged: () => void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: TelegramWebAppInitData;
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  headerColor: string;
  backgroundColor: string;
  ready: () => void;
  expand: () => void;
  close: () => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  showAlert: (message: string, callback?: () => void) => void;
  showConfirm: (message: string, callback?: (confirmed: boolean) => void) => void;
  HapticFeedback?: TelegramHapticFeedback;
  MainButton: {
    setText: (text: string) => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
  };
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  onEvent: (event: string, cb: () => void) => void;
  offEvent: (event: string, cb: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

function subscribe(onStoreChange: () => void): () => void {
  const tg = getWebApp();
  if (!tg) return () => {};
  tg.onEvent?.("themeChanged", onStoreChange);
  tg.onEvent?.("viewportChanged", onStoreChange);
  return () => {
    tg.offEvent?.("themeChanged", onStoreChange);
    tg.offEvent?.("viewportChanged", onStoreChange);
  };
}

function getSnapshot(): TelegramWebApp | null {
  return getWebApp();
}

function getServerSnapshot(): TelegramWebApp | null {
  return null;
}

function getIsClient(): boolean {
  return true;
}

function getIsServer(): boolean {
  return false;
}

export interface UseTelegram {
  webApp: TelegramWebApp | null;
  isReady: boolean;
  isInTelegram: boolean;
  initData: string;
  user: TelegramWebAppUser | null;
  haptic: (style?: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
  notify: (type: "error" | "success" | "warning") => void;
  selection: () => void;
  expand: () => void;
  openLink: (url: string) => void;
  close: () => void;
  startParam: string | null;
}

/**
 * Safely bridges React with the Telegram WebApp SDK via `useSyncExternalStore`.
 * Every SDK call is guarded so the app keeps working in a normal browser / SSR
 * where the SDK is absent.
 */
export function useTelegram(): UseTelegram {
  const webApp = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isClient = useSyncExternalStore(subscribeNoop, getIsClient, getIsServer);

  useEffect(() => {
    const tg = getWebApp();
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      tg.setHeaderColor?.("#0B0E14");
      tg.setBackgroundColor?.("#0B0E14");
    } catch {
      /* older clients may not implement these methods */
    }
  }, []);

  const haptic = useCallback(
    (style: "light" | "medium" | "heavy" | "rigid" | "soft" = "medium") => {
      try {
        getWebApp()?.HapticFeedback?.impactOccurred(style);
      } catch {
        /* noop */
      }
    },
    [],
  );

  const notify = useCallback((type: "error" | "success" | "warning") => {
    try {
      getWebApp()?.HapticFeedback?.notificationOccurred(type);
    } catch {
      /* noop */
    }
  }, []);

  const selection = useCallback(() => {
    try {
      getWebApp()?.HapticFeedback?.selectionChanged();
    } catch {
      /* noop */
    }
  }, []);

  const expand = useCallback(() => {
    try {
      getWebApp()?.expand();
    } catch {
      /* noop */
    }
  }, []);

  const openLink = useCallback((url: string) => {
    if (!url) return;
    const tg = getWebApp();
    try {
      if (tg && /^https?:\/\//.test(url)) {
        tg.openLink(url, { try_instant_view: false });
      } else if (typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch {
      if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  const close = useCallback(() => {
    try {
      getWebApp()?.close();
    } catch {
      /* noop */
    }
  }, []);

  const user = useMemo(() => webApp?.initDataUnsafe?.user ?? null, [webApp]);
  const startParam = useMemo(() => webApp?.initDataUnsafe?.start_param ?? null, [webApp]);

  return {
    webApp,
    isReady: isClient,
    isInTelegram: Boolean(webApp),
    initData: webApp?.initData ?? "",
    user,
    haptic,
    notify,
    selection,
    expand,
    openLink,
    close,
    startParam,
  };
}

function subscribeNoop(): () => void {
  return () => {};
}
