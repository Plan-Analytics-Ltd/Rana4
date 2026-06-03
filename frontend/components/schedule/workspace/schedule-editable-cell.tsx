"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function ScheduleEditableCell(props: {
  value: string;
  editable: boolean;
  active: boolean;
  align?: "left" | "right";
  mono?: boolean;
  width: number;
  title?: string;
  onActivate: () => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
  validate?: (value: string) => string | null;
}) {
  const { value, editable, active, align = "left", mono, width, title, onActivate, onCommit, onCancel, validate } =
    props;
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active) {
      setDraft(value);
      queueMicrotask(() => inputRef.current?.select());
    }
  }, [active, value]);

  if (!editable) {
    return (
      <span
        className={cn("block truncate px-1", mono && "font-mono", align === "right" && "text-right")}
        style={{ width }}
        title={title ?? value}
      >
        {value || "—"}
      </span>
    );
  }

  if (!active) {
    return (
      <button
        type="button"
        className={cn(
          "h-full w-full truncate rounded px-1 text-left hover:bg-cyan-500/10 focus:outline-none focus:ring-1 focus:ring-cyan-500/50",
          mono && "font-mono tabular-nums text-right",
          align === "right" && "text-right"
        )}
        style={{ width }}
        title={title ?? `${value} — double-click to edit`}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onActivate();
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {value || "—"}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      className={cn(
        "h-[22px] rounded border border-cyan-500 bg-white px-1 text-xs shadow-sm dark:border-cyan-600 dark:bg-slate-900",
        mono && "font-mono tabular-nums",
        align === "right" && "text-right"
      )}
      style={{ width: width - 2 }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const err = validate?.(draft);
          if (err) return;
          onCommit(draft);
        }
      }}
      onBlur={() => {
        const err = validate?.(draft);
        if (err) {
          onCancel();
          return;
        }
        onCommit(draft);
      }}
    />
  );
}
