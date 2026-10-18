import type { ComponentType } from "react";
import {
  LayoutDashboard,
  ListChecks,
  Megaphone,
  ScrollText,
  SlidersHorizontal,
  Users,
  Wallet,
} from "lucide-react";

/** Sections of the control room. Shared by the sidebar and the content header. */
export type Tab = "overview" | "payouts" | "users" | "tasks" | "settings" | "broadcast" | "audit";

export interface NavItem {
  key: Tab;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard },
  { key: "payouts", label: "Payouts", Icon: Wallet },
  { key: "users", label: "Users", Icon: Users },
  { key: "tasks", label: "Tasks", Icon: ListChecks },
  { key: "settings", label: "Settings", Icon: SlidersHorizontal },
  { key: "broadcast", label: "Broadcast", Icon: Megaphone },
  { key: "audit", label: "Audit", Icon: ScrollText },
];

/** Slim header copy per section (presentation only). */
export const SECTION_SUBTITLES: Record<Tab, string> = {
  overview:
    "Full operator surface — the in-app Quick Panel keeps only payouts, bans and wallet glance.",
  payouts: "Approve, reject and audit withdrawal requests.",
  users: "Search, moderate and adjust balances.",
  tasks: "Create and manage the task catalog.",
  settings: "Every business number lives in platform_settings — saved per field, live on next request.",
  broadcast: "Send one message to every non-banned user.",
  audit: "Every privileged write, newest first.",
};
