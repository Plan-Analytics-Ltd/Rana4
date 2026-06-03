import { prisma } from "../utils/prisma.js";
import { activityDeliverableInclude } from "./activityDeliverableLinks.service.js";

export const PROJECT_LEVEL_STANDARD_NAME = "Project-level activities";
export const PROJECT_LEVEL_FRAGNET_NAME = "Project-level / unassigned";
export const PROJECT_LEVEL_DELIVERABLE_NAME = "Unassigned Deliverable";

export async function ensureProjectLevelActivityContext(projectId: string, companyId: string) {
  return prisma.$transaction(async (tx) => {
    let standard = await tx.standard.findFirst({
      where: { projectId, companyId, name: PROJECT_LEVEL_STANDARD_NAME },
    });
    if (!standard) {
      standard = await tx.standard.create({
        data: {
          projectId,
          companyId,
          name: PROJECT_LEVEL_STANDARD_NAME,
          description: "System-managed bucket for activities created without a stage/fragnet.",
        },
      });
    }

    let fragnet = await tx.fragnet.findFirst({
      where: {
        projectId,
        companyId,
        standardId: standard.id,
        name: PROJECT_LEVEL_FRAGNET_NAME,
      },
    });
    if (!fragnet) {
      fragnet = await tx.fragnet.create({
        data: {
          projectId,
          companyId,
          standardId: standard.id,
          name: PROJECT_LEVEL_FRAGNET_NAME,
          description: "System-managed fragnet for project-level activities.",
        },
      });
    }

    let deliverable = await tx.deliverable.findFirst({
      where: {
        projectId,
        companyId,
        fragnetId: fragnet.id,
        name: PROJECT_LEVEL_DELIVERABLE_NAME,
      },
    });
    if (!deliverable) {
      const existingUnassigned = await tx.deliverable.findFirst({
        where: {
          projectId,
          companyId,
          fragnetId: null,
          name: PROJECT_LEVEL_DELIVERABLE_NAME,
        },
      });
      deliverable = existingUnassigned
        ? await tx.deliverable.update({
            where: { id: existingUnassigned.id },
            data: { fragnetId: fragnet.id },
          })
        : await tx.deliverable.create({
            data: {
              projectId,
              companyId,
              fragnetId: fragnet.id,
              name: PROJECT_LEVEL_DELIVERABLE_NAME,
              bestDuration: 1,
              likelyDuration: 1,
              assignedResources: [],
            },
          });
    }

    return { standard, fragnet, deliverable };
  });
}

export async function getProjectLevelActivityContext(projectId: string, companyId: string) {
  const standard = await prisma.standard.findFirst({
    where: { projectId, companyId, name: PROJECT_LEVEL_STANDARD_NAME },
    select: { id: true },
  });
  if (!standard) {
    const unassignedDeliverables = await prisma.deliverable.findMany({
      where: { projectId, companyId, fragnetId: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { activityCodeAssignments: { include: { type: true, code: true } } },
    });
    return {
      standardId: null,
      fragnetId: null,
      deliverables: unassignedDeliverables,
      activities: [],
    };
  }

  const fragnet = await prisma.fragnet.findFirst({
    where: {
      projectId,
      companyId,
      standardId: standard.id,
      name: PROJECT_LEVEL_FRAGNET_NAME,
    },
    select: { id: true },
  });

  const deliverables = await prisma.deliverable.findMany({
    where: {
      projectId,
      companyId,
      OR: [{ fragnetId: null }, ...(fragnet ? [{ fragnetId: fragnet.id }] : [])],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { activityCodeAssignments: { include: { type: true, code: true } } },
  });

  const activities = fragnet
    ? await prisma.activity.findMany({
        where: { projectId, companyId, fragnetId: fragnet.id },
        orderBy: [{ activityCode: "asc" }, { id: "asc" }],
        include: {
          activityCodeAssignments: { include: { type: true, code: true } },
          ...activityDeliverableInclude,
        },
      })
    : [];

  return {
    standardId: standard.id,
    fragnetId: fragnet?.id ?? null,
    deliverables,
    activities,
  };
}

