"use client";

import { useEffect, useState } from "react";
import { projectsApi, type ActivityCodeAvailability } from "@/lib/api";

export function useActivityCodeAvailability(
  projectId: string | null,
  fragnetId: string | null,
  activityCode: string,
  excludeActivityId?: string | null
): { status: ActivityCodeAvailability | null; checking: boolean } {
  const [status, setStatus] = useState<ActivityCodeAvailability | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!projectId || !fragnetId || !activityCode.trim()) {
      setStatus(null);
      setChecking(false);
      return;
    }

    setChecking(true);
    const handle = window.setTimeout(() => {
      void projectsApi
        .checkActivityCodeAvailability(projectId, {
          code: activityCode,
          fragnetId,
          excludeActivityId: excludeActivityId ?? undefined,
        })
        .then(({ data }) => setStatus(data))
        .catch(() => setStatus(null))
        .finally(() => setChecking(false));
    }, 320);

    return () => {
      window.clearTimeout(handle);
      setChecking(false);
    };
  }, [projectId, fragnetId, activityCode, excludeActivityId]);

  return { status, checking };
}
