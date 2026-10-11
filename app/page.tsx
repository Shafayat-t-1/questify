import { Suspense } from "react";
import { QuestifyApp } from "@/components/AppShell";
import { BootSplash } from "@/components/ui/BootSplash";

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="app-bg mx-auto min-h-dvh w-full max-w-md">
          <BootSplash />
        </div>
      }
    >
      <QuestifyApp />
    </Suspense>
  );
}
