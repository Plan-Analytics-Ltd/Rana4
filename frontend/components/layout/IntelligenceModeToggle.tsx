"use client";

import { Brain, LayoutGrid } from "lucide-react";
import { useIntelligenceMode } from "@/contexts/intelligence-mode-context";
import { cn } from "@/lib/utils";

export function IntelligenceModeToggle() {
  const { mode, setMode } = useIntelligenceMode();

  return (
    <div
      className="flex shrink-0 items-center rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-700 dark:bg-slate-800/80"
      role="group"
      aria-label="Workspace mode"
    >
      <button
        type="button"
        onClick={() => setMode("platform")}
        className={cn(
          "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
          mode === "platform"
            ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
            : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        )}
        aria-pressed={mode === "platform"}
      >
        <LayoutGrid className="h-4 w-4" aria-hidden />
        Platform
      </button>
      <button
        type="button"
        onClick={() => setMode("intelligence")}
        className={cn(
          "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
          mode === "intelligence"
            ? "bg-violet-600 text-white shadow-sm dark:bg-violet-500"
            : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        )}
        aria-pressed={mode === "intelligence"}
      >
        <Brain className="h-4 w-4" aria-hidden />
        Intelligence
      </button>
    </div>
  );
}
