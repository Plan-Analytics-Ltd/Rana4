import { prisma } from "../../../utils/prisma.js";
import type { IntelligenceClassificationTags } from "../shared/types.js";

const APPROVAL_KEYWORDS = ["approval", "authority", "permit", "sign-off", "signoff"];
const MEP_KEYWORDS = ["mep", "coordination", "services", "hvac", "electrical", "mechanical"];

export async function getProjectIntelligenceProfile(projectId: string, companyId: string) {
  return prisma.projectIntelligenceProfile.findFirst({
    where: { projectId, companyId },
  });
}

export async function upsertProjectIntelligenceProfile(
  projectId: string,
  companyId: string,
  data: IntelligenceClassificationTags & { complexityScore?: number }
) {
  const { complexityScore, ...tags } = data;
  return prisma.projectIntelligenceProfile.upsert({
    where: { projectId },
    create: {
      projectId,
      companyId,
      projectType: tags.projectType ?? null,
      primaryRibaStage: tags.ribaStage ?? null,
      complexityScore: complexityScore ?? null,
      classificationTags: tags as object,
      complexityMetrics: {},
    },
    update: {
      projectType: tags.projectType ?? undefined,
      primaryRibaStage: tags.ribaStage ?? undefined,
      complexityScore: complexityScore ?? undefined,
      classificationTags: tags as object,
    },
  });
}

/** Derive intelligence metadata from live project + activity code assignments. */
export async function refreshProjectIntelligenceMetadata(
  projectId: string,
  companyId: string
): Promise<void> {
  const [activities, assignments, deliverables] = await Promise.all([
    prisma.activity.count({ where: { projectId, companyId } }),
    prisma.activityCodeAssignment.findMany({
      where: {
        companyId,
        OR: [
          { activity: { projectId, companyId } },
          { deliverable: { projectId, companyId } },
        ],
      },
      include: { type: true, code: true },
    }),
    prisma.deliverable.count({ where: { projectId, companyId } }),
  ]);

  const disciplineCategories = new Set<string>();
  const approvalRouteCategories = new Set<string>();
  const healthcareDepartments = new Set<string>();
  const deliverableClassifications = new Set<string>();
  let ribaStage: string | undefined;

  for (const a of assignments) {
    const slug = a.type.slug.toLowerCase();
    const value = (a.code.shortName ?? a.code.name).trim();
    if (slug.includes("riba") || slug.includes("stage")) {
      ribaStage = value;
    }
    if (slug.includes("discipline")) disciplineCategories.add(value);
    if (slug.includes("approval")) approvalRouteCategories.add(value);
    if (slug.includes("department") || slug.includes("healthcare")) {
      healthcareDepartments.add(value);
    }
    if (slug.includes("deliverable") || slug.includes("type")) {
      deliverableClassifications.add(value);
    }
  }

  const criticalCount = await prisma.activity.count({
    where: { projectId, companyId, isCritical: true },
  });

  const complexityMetrics = {
    activityCount: activities,
    deliverableCount: deliverables,
    criticalActivityCount: criticalCount,
    mepDensity: assignments.filter((a) =>
      MEP_KEYWORDS.some((k) => (a.code.name + a.type.slug).toLowerCase().includes(k))
    ).length,
    approvalAssignmentCount: assignments.filter((a) =>
      APPROVAL_KEYWORDS.some((k) => (a.code.name + a.type.slug).toLowerCase().includes(k))
    ).length,
  };

  const complexityScore = Math.min(
    1,
    (activities / 200) * 0.4 + (criticalCount / Math.max(activities, 1)) * 0.3 + (deliverables / 50) * 0.3
  );

  await upsertProjectIntelligenceProfile(projectId, companyId, {
    ribaStage,
    disciplineCategories: [...disciplineCategories],
    approvalRouteCategories: [...approvalRouteCategories],
    healthcareDepartments: [...healthcareDepartments],
    deliverableClassifications: [...deliverableClassifications],
    complexityScore: Math.round(complexityScore * 1000) / 1000,
  });

  await prisma.projectIntelligenceProfile.updateMany({
    where: { projectId },
    data: { complexityMetrics: complexityMetrics as object },
  });
}

/** Attach classification tags to imported activity rows from P6 assignments. */
export async function enrichActivityRowsWithClassifications(
  projectId: string,
  companyId: string,
  activityIds: string[]
): Promise<Map<string, Record<string, string>>> {
  if (activityIds.length === 0) return new Map();

  const assignments = await prisma.activityCodeAssignment.findMany({
    where: { companyId, activityId: { in: activityIds } },
    include: { type: true, code: true },
  });

  const byActivity = new Map<string, Record<string, string>>();
  for (const a of assignments) {
    if (!a.activityId) continue;
    const tags = byActivity.get(a.activityId) ?? {};
    tags[a.type.slug] = a.code.shortName ?? a.code.name;
    byActivity.set(a.activityId, tags);
  }
  return byActivity;
}
