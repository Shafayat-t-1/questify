import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUsdt(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatCoins(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? value : 0);
}

/** Accept only http(s) URLs; returns null for anything else (or empty). */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function shortenWallet(address: string, size = 4): string {
  if (!address) return "";
  if (address.length <= size * 2 + 3) return address;
  return `${address.slice(0, size)}...${address.slice(-size)}`;
}

export function maskName(name: string): string {
  if (!name) return "***";
  const end = name.length > 2 ? name.slice(-1) : "";
  return `${name.slice(0, 1)}***${end}`;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "just now";
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(
    secs,
  ).padStart(2, "0")}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function levelProgress(coins: number) {
  const levelSize = 1000;
  const level = Math.floor(coins / levelSize) + 1;
  const inLevel = coins % levelSize;
  return { level, inLevel, levelSize, percent: (inLevel / levelSize) * 100 };
}

export const LEVEL_TITLES = [
  "Newbie",
  "Explorer",
  "Hunter",
  "Grinder",
  "Pro",
  "Elite",
  "Veteran",
  "Master",
  "Legend",
  "Mythic",
] as const;

export function levelTitle(level: number): string {
  return LEVEL_TITLES[clamp(level - 1, 0, LEVEL_TITLES.length - 1)];
}
