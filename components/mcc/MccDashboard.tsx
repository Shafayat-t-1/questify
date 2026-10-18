"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { adminFetch } from "@/lib/admin-client";
import { cn } from "@/lib/utils";
import { useMccLive } from "@/hooks/useMccLive";
import { MccHeader } from "./MccHeader";
import { MccSidebar } from "./MccSidebar";
import { OverviewPanel } from "./OverviewPanel";
import { PayoutsPanel } from "./PayoutsPanel";
import { UsersPanel } from "./UsersPanel";
import { TasksPanel } from "./TasksPanel";
import { AuditPanel, BroadcastPanel, SettingsPanel } from "./MiscPanels";
import { NAV_ITEMS, SECTION_SUBTITLES, type Tab } from "./nav";
import type { MccData, MccLiveData } from "./types";

interface Toast {
  id: number;
  kind: "success" | "error";
  title: string;
  message: string;
}

export function MccDashboard() {
  const [data, setData] = useState<MccData | null>(null);
  const [live, setLive] = useState<MccLiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const notify = useCallback((kind: "success" | "error", title: string, message: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, kind, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5200);
  }, []);

  const fetchFull = useCallback(() => adminFetch<MccData>("/api/admin"), []);
  const fetchLive = useCallback(() => adminFetch<MccLiveData>("/api/mcc/live"), []);

  const loadFull = useCallback(async () => {
    const res = await fetchFull();
    if (!res.ok || !res.data) {
      setError(res.error ?? "failed");
      setLoading(false);
      return;
    }
    setError(null);
    setData(res.data);
    setLoading(false);
  }, [fetchFull]);

  const loadLive = useCallback(async () => {
    const res = await fetchLive();
    if (res.ok && res.data) setLive(res.data);
  }, [fetchLive]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadFull(), loadLive()]);
  }, [loadFull, loadLive]);

  const onTick = useCallback(() => {
    void loadLive();
  }, [loadLive]);

  const { lastTickAt } = useMccLive(onTick);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const [full, lv] = await Promise.all([fetchFull(), fetchLive()]);
      if (cancelled) return;
      if (full.ok && full.data) {
        setData(full.data);
        setError(null);
      } else {
        setError(full.error ?? "failed");
      }
      if (lv.ok && lv.data) setLive(lv.data);
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [fetchFull, fetchLive]);

  // Re-fetch the heavy tables whenever the operator opens a data tab, so a
  // stale queue from another tab never lingers.
  useEffect(() => {
    if (tab === "overview" || tab === "broadcast") return;
    let cancelled = false;
    const run = async () => {
      const res = await fetchFull();
      if (cancelled || !res.ok || !res.data) return;
      setData(res.data);
      setError(null);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [tab, fetchFull]);

  const pendingCount = live?.stats.pendingWithdrawals ?? data?.stats.pendingWithdrawals ?? 0;
  const sectionLabel = NAV_ITEMS.find((item) => item.key === tab)?.label ?? "Overview";

  return (
    <div className="mcc-shell flex h-dvh overflow-hidden bg-mcc-bg text-mcc-text">
      <MccSidebar active={tab} onSelect={setTab} pendingCount={pendingCount} />

      <div className="flex min-w-0 flex-1 flex-col">
        <MccHeader
          title={sectionLabel}
          description={SECTION_SUBTITLES[tab]}
          loading={loading}
          onRefresh={() => void refreshAll()}
        />

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1440px] space-y-5 pb-8">
            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                {error === "forbidden" || error === "unauthorized"
                  ? "Your session is no longer authorized. Sign in again."
                  : `Admin error: ${error}`}
              </div>
            )}

            {loading && !data ? (
              <div className="grid place-items-center py-20">
                <RefreshCw className="h-5 w-5 animate-spin text-mcc-gold" />
              </div>
            ) : data ? (
              <>
                {tab === "overview" && <OverviewPanel data={data} live={live} lastTickAt={lastTickAt} />}
                {tab === "payouts" && (
                  <PayoutsPanel withdrawals={data.withdrawals} onReload={() => void refreshAll()} notify={notify} />
                )}
                {tab === "users" && <UsersPanel users={data.users} onReload={() => void loadFull()} notify={notify} />}
                {tab === "tasks" && <TasksPanel tasks={data.tasks} onReload={() => void loadFull()} notify={notify} />}
                {tab === "settings" && <SettingsPanel settings={data.settings ?? []} notify={notify} />}
                {tab === "broadcast" && <BroadcastPanel notify={notify} />}
                {tab === "audit" && <AuditPanel actions={data.actions} />}
              </>
            ) : null}
          </div>
        </main>
      </div>

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-xl border p-3 shadow-xl backdrop-blur-xl",
              t.kind === "success"
                ? "border-emerald-400/30 bg-emerald-500/15"
                : "border-red-500/30 bg-red-500/15",
            )}
          >
            <p className="text-xs font-bold text-mcc-text">{t.title}</p>
            <p className="mt-0.5 text-[11px] text-mcc-muted">{t.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
