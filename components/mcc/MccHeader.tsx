"use client";

import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface MccHeaderProps {
  title: string;
  description?: string;
  loading: boolean;
  onRefresh: () => void;
}

/** Slim header bar above the control-room content: current section + refresh. */
export function MccHeader({ title, description, loading, onRefresh }: MccHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-mcc-line bg-mcc-bg/90 px-4 py-3.5 backdrop-blur-md sm:px-6 lg:px-8">
      <div className="min-w-0">
        <h1 className="truncate text-[15px] font-semibold tracking-tight text-mcc-text">{title}</h1>
        {description && <p className="truncate text-[11px] text-mcc-dim">{description}</p>}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        title="Refresh data"
        aria-label="Refresh data"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-mcc-line bg-mcc-surface text-mcc-muted transition hover:border-mcc-line-strong hover:text-mcc-text active:scale-95"
      >
        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
      </button>
    </header>
  );
}
