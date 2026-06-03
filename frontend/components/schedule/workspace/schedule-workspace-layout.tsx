"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function ScheduleWorkspaceLayout(props: {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLeftPercent?: number;
}) {
  const { left, right, defaultLeftPercent = 65 } = props;
  const [leftPct, setLeftPct] = useState(defaultLeftPercent);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftPct(Math.min(75, Math.max(48, pct)));
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dragging.current = false;
    };
    window.addEventListener("keyup", onKey);
    return () => window.removeEventListener("keyup", onKey);
  }, []);

  return (
    <div ref={containerRef} className="flex h-full min-h-0 w-full overflow-hidden">
      <div className="min-h-0 shrink-0 overflow-hidden" style={{ width: `${leftPct}%` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize schedule panes"
        className={cn(
          "relative z-30 w-1 shrink-0 cursor-col-resize bg-slate-300 hover:bg-cyan-500 dark:bg-slate-600 dark:hover:bg-cyan-500",
          dragging.current && "bg-cyan-500"
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{right}</div>
    </div>
  );
}
