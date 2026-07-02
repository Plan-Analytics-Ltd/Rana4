"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { intelligenceApi, type DeliverableIntelligenceAnalysis } from "@/lib/api";
import { snapshotFromAnalysis, type DeliverableStatusSnapshot } from "@/lib/deliverable-intelligence-status";

const globalCache = new Map<string, DeliverableIntelligenceAnalysis>();

function cacheKey(projectId: string, deliverableId: string) {
  return `${projectId}:${deliverableId}`;
}

async function fetchWithConcurrency(
  projectId: string,
  ids: string[],
  concurrency: number,
  onResult: (id: string, data: DeliverableIntelligenceAnalysis) => void,
  signal: AbortSignal
) {
  const queue = [...ids];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0 && !signal.aborted) {
      const id = queue.shift();
      if (!id) break;
      const key = cacheKey(projectId, id);
      if (globalCache.has(key)) {
        onResult(id, globalCache.get(key)!);
        continue;
      }
      try {
        const { data } = await intelligenceApi.getDeliverableIntelligenceAnalysis(projectId, id);
        if (signal.aborted) return;
        globalCache.set(key, data);
        onResult(id, data);
      } catch {
        /* skip failed deliverables */
      }
    }
  });
  await Promise.all(workers);
}

export function useDeliverableIntelligenceCache(projectId: string | null, deliverableIds: string[]) {
  const [snapshots, setSnapshots] = useState<Map<string, DeliverableStatusSnapshot>>(new Map());
  const [loading, setLoading] = useState(false);
  const idsKey = useMemo(() => deliverableIds.slice().sort().join(","), [deliverableIds]);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    if (!projectId || deliverableIds.length === 0) {
      setSnapshots(new Map());
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);

    const next = new Map<string, DeliverableStatusSnapshot>();
    for (const id of deliverableIds) {
      const cached = globalCache.get(cacheKey(projectId, id));
      if (cached) next.set(id, snapshotFromAnalysis(cached));
    }
    setSnapshots(new Map(next));

    void fetchWithConcurrency(
      projectId,
      deliverableIds.filter((id) => !globalCache.has(cacheKey(projectId, id))),
      4,
      (id, data) => {
        setSnapshots((prev) => {
          const m = new Map(prev);
          m.set(id, snapshotFromAnalysis(data));
          return m;
        });
      },
      ac.signal
    ).finally(() => {
      if (!ac.signal.aborted) setLoading(false);
    });
  }, [projectId, deliverableIds]);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh, idsKey, projectId]);

  const getSnapshot = useCallback((id: string) => snapshots.get(id), [snapshots]);

  return { snapshots, loading, getSnapshot, refresh };
}

export function invalidateDeliverableIntelligenceCache(projectId: string, deliverableId?: string) {
  if (deliverableId) {
    globalCache.delete(cacheKey(projectId, deliverableId));
    return;
  }
  for (const key of globalCache.keys()) {
    if (key.startsWith(`${projectId}:`)) globalCache.delete(key);
  }
}
