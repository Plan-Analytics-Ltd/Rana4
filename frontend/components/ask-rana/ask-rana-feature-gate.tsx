"use client";

import type { ReactNode } from "react";
import { AskRanaProvider } from "@/contexts/ask-rana-context";
import { useAskRanaFeature } from "@/contexts/ask-rana-feature-context";

/** Mounts Ask Rana only when the feature toggle is enabled. */
export function AskRanaFeatureGate({ children }: { children: ReactNode }) {
  const { enabled } = useAskRanaFeature();

  if (!enabled) {
    return children;
  }

  return <AskRanaProvider>{children}</AskRanaProvider>;
}
