"use client";

import { useEffect, useState } from "react";
import { projectsApi } from "@/lib/api";

/** Next sequential activity ID for the project (e.g. A1700 → suggests A1701). */
export function useNextActivityCode(
  projectId: string | null,
  enabled: boolean,
  excludeActivityId?: string | null
): {
  nextCode: string | null;
  loading: boolean;
} {
  const [nextCode, setNextCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !projectId) {
      setNextCode(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void projectsApi
      .getSuggestedActivityCode(projectId, excludeActivityId ?? undefined)
      .then(({ data }) => setNextCode(data.activityCode))
      .catch(() => setNextCode(null))
      .finally(() => setLoading(false));
  }, [projectId, enabled, excludeActivityId]);

  return { nextCode, loading };
}
