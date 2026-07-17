"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  deliverablesApi,
  type Deliverable,
  type DeliverableDurationStatisticsItem,
} from "@/lib/api";

export function useDeliverableDurationStatistics(
  projectId: string | null | undefined,
  deliverables: Deliverable[]
) {
  const [items, setItems] = useState<DeliverableDurationStatisticsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedSignature, setLoadedSignature] = useState("");
  const requestRef = useRef(0);
  const targetSignature = deliverables.map((deliverable) => deliverable.id).join("|");
  const requestSignature = `${projectId ?? ""}:${targetSignature}`;

  useEffect(() => {
    const requestId = ++requestRef.current;
    if (!projectId || deliverables.length === 0) {
      setItems([]);
      setLoading(false);
      setLoadedSignature(requestSignature);
      return;
    }

    setLoading(true);
    void deliverablesApi
      .durationStatistics(
        projectId,
        deliverables.map((deliverable) => ({
          key: deliverable.id,
          deliverableId: deliverable.id,
        }))
      )
      .then(({ data }) => {
        if (requestRef.current === requestId) setItems(data.items ?? []);
      })
      .catch(() => {
        if (requestRef.current === requestId) setItems([]);
      })
      .finally(() => {
        if (requestRef.current === requestId) {
          setLoading(false);
          setLoadedSignature(requestSignature);
        }
      });
  }, [projectId, targetSignature]); // IDs are the stable identity of the bulk request.

  const byDeliverableId = useMemo(
    () => new Map(items.map((item) => [item.deliverableId ?? item.key, item])),
    [items]
  );

  return {
    byDeliverableId,
    loading:
      loading ||
      Boolean(projectId && deliverables.length > 0 && loadedSignature !== requestSignature),
  };
}

export function useDeliverableDurationDraftStatistics(params: {
  projectId: string | null | undefined;
  name: string;
  deliverableId?: string | null;
  enabled: boolean;
}) {
  const { projectId, name, deliverableId, enabled } = params;
  const [item, setItem] = useState<DeliverableDurationStatisticsItem | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestRef.current;
    const trimmedName = name.trim();
    if (!enabled || !projectId || (!deliverableId && trimmedName.length < 3)) {
      setItem(null);
      setLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setLoading(true);
      void deliverablesApi
        .durationStatistics(projectId, [
          {
            key: "draft",
            ...(deliverableId ? { deliverableId } : {}),
            ...(!deliverableId && trimmedName ? { name: trimmedName } : {}),
          },
        ])
        .then(({ data }) => {
          if (requestRef.current === requestId) setItem(data.items?.[0] ?? null);
        })
        .catch(() => {
          if (requestRef.current === requestId) setItem(null);
        })
        .finally(() => {
          if (requestRef.current === requestId) setLoading(false);
        });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [projectId, name, deliverableId, enabled]);

  return { item, loading };
}
