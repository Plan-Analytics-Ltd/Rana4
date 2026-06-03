import { prisma } from "../utils/prisma.js";
import { syncSharedActivityToLinkedDeliverableFsLinks } from "./sharedActivityToDeliverableLink.service.js";

type SyncActivityDeliverableLinksArgs = {
  activityId: string;
  projectId: string;
  companyId: string;
  primaryDeliverableId: string;
  deliverableIds?: string[];
};

function normalizeDeliverableIds(primaryDeliverableId: string, deliverableIds?: string[]): string[] {
  const ordered = [primaryDeliverableId, ...(deliverableIds ?? [])]
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);
  return [...new Set(ordered)];
}

export async function syncActivityDeliverableLinks(
  args: SyncActivityDeliverableLinksArgs
): Promise<void> {
  const nextDeliverableIds = normalizeDeliverableIds(args.primaryDeliverableId, args.deliverableIds);

  await prisma.activity.update({
    where: { id: args.activityId },
    data: { deliverableId: args.primaryDeliverableId },
  });

  await prisma.activityDeliverable.deleteMany({
    where: {
      activityId: args.activityId,
      companyId: args.companyId,
      deliverableId: { notIn: nextDeliverableIds },
    },
  });

  for (const deliverableId of nextDeliverableIds) {
    await prisma.activityDeliverable.upsert({
      where: {
        activityId_deliverableId: {
          activityId: args.activityId,
          deliverableId,
        },
      },
      create: {
        activityId: args.activityId,
        deliverableId,
        projectId: args.projectId,
        companyId: args.companyId,
        isPrimary: deliverableId === args.primaryDeliverableId,
      },
      update: {
        isPrimary: deliverableId === args.primaryDeliverableId,
        projectId: args.projectId,
      },
    });
  }

  const activity = await prisma.activity.findFirst({
    where: { id: args.activityId, companyId: args.companyId },
    select: { isSharedAcrossDeliverables: true },
  });
  if (activity?.isSharedAcrossDeliverables) {
    await syncSharedActivityToLinkedDeliverableFsLinks(args.activityId, args.companyId);
  }
}

export async function ensureSingleActivityDeliverableLink(params: {
  activityId: string;
  deliverableId: string;
  projectId: string;
  companyId: string;
}): Promise<void> {
  await syncActivityDeliverableLinks({
    activityId: params.activityId,
    primaryDeliverableId: params.deliverableId,
    deliverableIds: [params.deliverableId],
    projectId: params.projectId,
    companyId: params.companyId,
  });
}

export const activityDeliverableInclude = {
  deliverableLinks: {
    orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
    include: {
      deliverable: {
        select: {
          id: true,
          name: true,
          fragnetId: true,
          projectId: true,
        },
      },
    },
  },
};

export function serializeLinkedDeliverables<
  T extends {
    deliverableLinks?: Array<{
      isPrimary?: boolean;
      deliverable: { id: string; name: string; fragnetId: string | null; projectId: string };
    }>;
  },
>(activity: T) {
  return {
    ...activity,
    linkedDeliverables: (activity.deliverableLinks ?? []).map((link) => ({
      id: link.deliverable.id,
      name: link.deliverable.name,
      fragnetId: link.deliverable.fragnetId,
      projectId: link.deliverable.projectId,
      isPrimary: Boolean(link.isPrimary),
    })),
  };
}
