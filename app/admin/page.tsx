import { redirect } from "next/navigation";

/**
 * The old standalone /admin page has been superseded by the Master Control
 * Center at /mcc (Phase 3A). Redirect permanently to keep old links working.
 */
export default function AdminPage() {
  redirect("/mcc");
}
