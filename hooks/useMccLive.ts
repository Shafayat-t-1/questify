"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

/**
 * Subscribes to the public `mcc_live_ticks` heartbeat (source + timestamp
 * only — no amounts, no ids) and invokes `onTick` whenever money moved
 * somewhere: wallet ledger insert, completed task, withdrawal change, plus
 * every window focus so returning to a backgrounded tab refreshes.
 *
 * The real numbers are fetched from the cookie-gated `/api/mcc/live` — never
 * from the realtime payload. No polling, no custom WS server.
 */
export function useMccLive(onTick: () => void): { lastTickAt: string | null } {
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const cbRef = useRef(onTick);

  useEffect(() => {
    cbRef.current = onTick;
  }, [onTick]);

  useEffect(() => {
    const supabase = getSupabase();
    let disposed = false;

    const fire = (at?: string | null) => {
      if (disposed) return;
      if (at) setLastTickAt(at);
      cbRef.current();
    };

    const onFocus = () => fire();

    if (supabase) {
      const channel = supabase
        .channel("mcc-live-ticks")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "mcc_live_ticks" },
          (payload) => {
            const p = payload as { new?: { at?: string } | null; old?: { at?: string } | null };
            const at = p.new?.at ?? p.old?.at ?? new Date().toISOString();
            fire(at);
          },
        )
        .subscribe();
      window.addEventListener("focus", onFocus);
      return () => {
        disposed = true;
        window.removeEventListener("focus", onFocus);
        void supabase.removeChannel(channel);
      };
    }

    // Realtime unavailable (no anon key) — focus still refreshes on visit.
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return { lastTickAt };
}
