import { recalculateProjectScheduleAfterMutation } from "./scheduleAutoRecalc.service.js";
import { syncDeliverableActivityLinkage } from "./deliverableActivityChain.service.js";
import { syncFragnetDeliverableToFirstActivityFsLinks } from "./deliverableFirstActivityLink.service.js";

export type ActivityDeleteLinkageSource = {
  fragnetId: string | null;
  deliverableId: string | null;
  isSharedAcrossDeliverables: boolean;
};

export function noteActivityDeleteLinkageTarget(
  source: ActivityDeleteLinkageSource,
  fragnetIds: Set<string>,
  deliverableIds: Set<string>
): void {
  if (source.isSharedAcrossDeliverables) return;
  if (source.fragnetId) {
    fragnetIds.add(source.fragnetId);
    return;
  }
  if (source.deliverableId) {
    deliverableIds.add(source.deliverableId);
  }
}

/** Run deliverable/fragnet linkage repair and one schedule recalc after one or more activity deletes. */
export async function applyActivityDeleteSideEffects(args: {
  companyId: string;
  projectId: string;
  fragnetIds: Iterable<string>;
  deliverableIds: Iterable<string>;
}): Promise<void> {
  for (const fragnetId of args.fragnetIds) {
    await syncFragnetDeliverableToFirstActivityFsLinks(fragnetId, args.companyId);
  }
  for (const deliverableId of args.deliverableIds) {
    await syncDeliverableActivityLinkage(deliverableId, args.companyId);
  }
  await recalculateProjectScheduleAfterMutation(args.projectId, args.companyId);
}
