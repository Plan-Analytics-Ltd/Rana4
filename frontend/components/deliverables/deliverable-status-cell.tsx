"use client";

import { DeliverableStatusBadge } from "@/components/intelligence/deliverable-status-badge";
import { useIntelligenceDrawerOptional } from "@/contexts/intelligence-drawer-context";
import type { DeliverableStatusSnapshot } from "@/lib/deliverable-intelligence-status";

type Props = {
  projectId: string | null;
  deliverableId: string;
  deliverableName: string;
  snapshot?: DeliverableStatusSnapshot;
  loading?: boolean;
};

export function DeliverableStatusCell({
  projectId,
  deliverableId,
  deliverableName,
  snapshot,
  loading,
}: Props) {
  const drawer = useIntelligenceDrawerOptional();

  return (
    <DeliverableStatusBadge
      snapshot={snapshot}
      loading={loading}
      onClick={
        projectId && drawer
          ? () =>
              drawer.openInsight({
                projectId,
                deliverableId,
                deliverableName,
              })
          : undefined
      }
    />
  );
}
