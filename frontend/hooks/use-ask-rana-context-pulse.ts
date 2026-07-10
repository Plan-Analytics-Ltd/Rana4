"use client";

import { useEffect, useRef, useState } from "react";

/** Brief glow when Ask Rana context changes (programme ↔ deliverable). */
export function useAskRanaContextPulse(contextKey: string): boolean {
  const [pulse, setPulse] = useState(false);
  const prevKey = useRef(contextKey);
  const initial = useRef(true);

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      prevKey.current = contextKey;
      return;
    }
    if (prevKey.current === contextKey) return;
    prevKey.current = contextKey;
    setPulse(true);
    const timer = window.setTimeout(() => setPulse(false), 1200);
    return () => window.clearTimeout(timer);
  }, [contextKey]);

  return pulse;
}
