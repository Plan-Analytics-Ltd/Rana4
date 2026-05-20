import type { Deliverable, Fragnet, FragnetActivityTemplate, Prisma, RelationshipType } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import {
  copyTemplateCodesToActivity,
  replaceActivityCodeAssignmentsForTemplate,
} from "./activityCodeAssignments.service.js";
import { parseAndValidateAssignedResources } from "./rateCard.js";

export type TemplateWithRelations = FragnetActivityTemplate & {
  predecessorIn: { id: string; predecessorTemplateId: string; successorTemplateId: string; relationshipType: RelationshipType; lag: number }[];
  successorIn: { id: string; predecessorTemplateId: string; successorTemplateId: string; relationshipType: RelationshipType; lag: number }[];
};

/** Short stable prefix for materialized activity codes within a fragnet. */
export function deliverableActivityCodePrefix(deliverable: { id: string; name: string }): string {
  const fromName = deliverable.name
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
  if (fromName.length >= 3) return fromName;
  return deliverable.id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function buildMaterializedActivityCode(prefix: string, templateCode: string): string {
  const safeTemplate = templateCode.trim().replace(/\s+/g, "_").slice(0, 64);
  const raw = `${prefix}-${safeTemplate}`.slice(0, 100);
  return raw;
}

async function uniqueActivityCode(
  fragnetId: string,
  companyId: string,
  base: string
): Promise<string> {
  let code = base;
  let n = 2;
  while (
    await prisma.activity.findFirst({
      where: { companyId, fragnetId, activityCode: code },
      select: { id: true },
    })
  ) {
    const suffix = `-${n}`;
    code = `${base.slice(0, 100 - suffix.length)}${suffix}`;
    n++;
  }
  return code;
}

/**
 * Clone fragnet templates into deliverable activities (idempotent per template+deliverable).
 */
export async function materializeTemplatesForDeliverable(
  deliverableId: string,
  companyId: string
): Promise<{ created: number; relationships: number }> {
  const deliverable = await prisma.deliverable.findFirst({
    where: { id: deliverableId, companyId },
  });
  if (!deliverable?.fragnetId) return { created: 0, relationships: 0 };

  const fragnet = await prisma.fragnet.findFirst({
    where: { id: deliverable.fragnetId, companyId },
  });
  if (!fragnet) return { created: 0, relationships: 0 };

  const templates = await prisma.fragnetActivityTemplate.findMany({
    where: { fragnetId: fragnet.id, companyId },
    orderBy: [{ orderIndex: "asc" }, { templateCode: "asc" }],
  });
  if (templates.length === 0) return { created: 0, relationships: 0 };

  const prefix = deliverableActivityCodePrefix(deliverable);
  const existing = await prisma.activity.findMany({
    where: { deliverableId, companyId, templateActivityId: { not: null } },
    select: { id: true, templateActivityId: true },
  });
  const byTemplateId = new Map(
    existing.filter((a) => a.templateActivityId).map((a) => [a.templateActivityId!, a.id])
  );

  let created = 0;
  for (const t of templates) {
    if (byTemplateId.has(t.id)) continue;
    const activityCode = await uniqueActivityCode(
      fragnet.id,
      companyId,
      buildMaterializedActivityCode(prefix, t.templateCode)
    );
    const row = await prisma.activity.create({
      data: {
        fragnetId: fragnet.id,
        deliverableId: deliverable.id,
        activityCode,
        name: t.name,
        bestDuration: t.bestDuration,
        likelyDuration: t.likelyDuration,
        assignedResources: t.assignedResources as Prisma.InputJsonValue,
        projectId: deliverable.projectId,
        companyId,
        isInherited: true,
        templateActivityId: t.id,
        detachedFromTemplate: false,
      },
    });
    byTemplateId.set(t.id, row.id);
    await copyTemplateCodesToActivity({
      companyId,
      templateActivityId: t.id,
      activityId: row.id,
    });
    created++;
  }

  const templateRels = await prisma.fragnetTemplateRelationship.findMany({
    where: { fragnetId: fragnet.id, companyId },
  });

  let relationships = 0;
  for (const tr of templateRels) {
    const predId = byTemplateId.get(tr.predecessorTemplateId);
    const succId = byTemplateId.get(tr.successorTemplateId);
    if (!predId || !succId || predId === succId) continue;

    const dup = await prisma.relationship.findFirst({
      where: {
        companyId,
        fragnetId: fragnet.id,
        predecessorActivityId: predId,
        successorActivityId: succId,
        relationshipType: tr.relationshipType,
      },
    });
    if (dup) continue;

    await prisma.relationship.create({
      data: {
        fragnetId: fragnet.id,
        predecessorActivityId: predId,
        successorActivityId: succId,
        relationshipType: tr.relationshipType,
        lag: tr.lag,
        projectId: deliverable.projectId,
        companyId,
      },
    });
    relationships++;
  }

  return { created, relationships };
}

/** Materialize templates for every deliverable on a fragnet (e.g. after new template added). */
export async function materializeTemplatesForAllDeliverables(
  fragnetId: string,
  companyId: string
): Promise<{ deliverables: number; activities: number; relationships: number }> {
  const deliverables = await prisma.deliverable.findMany({
    where: { fragnetId, companyId },
    select: { id: true },
  });
  let activities = 0;
  let relationships = 0;
  for (const d of deliverables) {
    const r = await materializeTemplatesForDeliverable(d.id, companyId);
    activities += r.created;
    relationships += r.relationships;
  }
  return { deliverables: deliverables.length, activities, relationships };
}

/**
 * Push template field updates to linked activities that are still inherited (not detached).
 */
export async function syncTemplatesToDeliverables(
  fragnetId: string,
  companyId: string
): Promise<{ updated: number }> {
  const templates = await prisma.fragnetActivityTemplate.findMany({
    where: { fragnetId, companyId },
  });
  const templateById = new Map(templates.map((t) => [t.id, t]));
  let updated = 0;

  const linked = await prisma.activity.findMany({
    where: {
      fragnetId,
      companyId,
      isInherited: true,
      detachedFromTemplate: false,
      templateActivityId: { not: null },
    },
  });

  for (const a of linked) {
    const t = a.templateActivityId ? templateById.get(a.templateActivityId) : undefined;
    if (!t) continue;
    await prisma.activity.update({
      where: { id: a.id },
      data: {
        name: t.name,
        bestDuration: t.bestDuration,
        likelyDuration: t.likelyDuration,
        assignedResources: t.assignedResources as Prisma.InputJsonValue,
      },
    });
    if (a.templateActivityId) {
      await copyTemplateCodesToActivity({
        companyId,
        templateActivityId: a.templateActivityId,
        activityId: a.id,
      });
    }
    updated++;
  }

  await materializeTemplatesForAllDeliverables(fragnetId, companyId);
  return { updated };
}

export async function detachActivityFromTemplate(activityId: string, companyId: string): Promise<void> {
  await prisma.activity.update({
    where: { id: activityId },
    data: { detachedFromTemplate: true, isInherited: false },
  });
}

export async function countTemplatesForFragnet(fragnetId: string, companyId: string): Promise<number> {
  return prisma.fragnetActivityTemplate.count({ where: { fragnetId, companyId } });
}

export async function listTemplatesForFragnet(
  fragnetId: string,
  companyId: string
): Promise<TemplateWithRelations[]> {
  return prisma.fragnetActivityTemplate.findMany({
    where: { fragnetId, companyId },
    orderBy: [{ orderIndex: "asc" }, { templateCode: "asc" }],
    include: {
      activityCodeAssignments: { include: { type: true, code: true } },
      predecessorIn: {
        select: {
          id: true,
          predecessorTemplateId: true,
          successorTemplateId: true,
          relationshipType: true,
          lag: true,
        },
      },
      successorIn: {
        select: {
          id: true,
          predecessorTemplateId: true,
          successorTemplateId: true,
          relationshipType: true,
          lag: true,
        },
      },
    },
  }) as Promise<TemplateWithRelations[]>;
}

export async function createTemplate(
  fragnet: Pick<Fragnet, "id" | "projectId" | "companyId">,
  input: {
    templateCode: string;
    name: string;
    bestDuration: number;
    likelyDuration: number;
    orderIndex?: number;
    assignedResources?: unknown;
    activityCodeByTypeId?: Record<string, string | null | undefined>;
  }
): Promise<FragnetActivityTemplate> {
  const assignedParsed = await parseAndValidateAssignedResources(fragnet.companyId, input.assignedResources ?? []);
  if (!assignedParsed.ok) throw Object.assign(new Error(assignedParsed.error), { status: 400 });

  const template = await prisma.fragnetActivityTemplate.create({
    data: {
      fragnetId: fragnet.id,
      companyId: fragnet.companyId,
      projectId: fragnet.projectId,
      templateCode: input.templateCode.trim(),
      name: input.name.trim(),
      bestDuration: input.bestDuration,
      likelyDuration: input.likelyDuration,
      orderIndex: input.orderIndex ?? 0,
      assignedResources: assignedParsed.assignments as Prisma.InputJsonValue,
    },
  });

  if (input.activityCodeByTypeId !== undefined) {
    await replaceActivityCodeAssignmentsForTemplate({
      companyId: fragnet.companyId,
      templateActivityId: template.id,
      byTypeId: input.activityCodeByTypeId,
    });
  }

  await materializeTemplatesForAllDeliverables(fragnet.id, fragnet.companyId);
  return template;
}

export async function createTemplateRelationship(
  fragnet: Pick<Fragnet, "id" | "projectId" | "companyId">,
  input: {
    predecessorTemplateId: string;
    successorTemplateId: string;
    relationshipType: RelationshipType;
    lag?: number;
  }
) {
  if (input.predecessorTemplateId === input.successorTemplateId) {
    throw Object.assign(new Error("Predecessor and successor must differ"), { status: 400 });
  }
  const rel = await prisma.fragnetTemplateRelationship.create({
    data: {
      fragnetId: fragnet.id,
      companyId: fragnet.companyId,
      projectId: fragnet.projectId,
      predecessorTemplateId: input.predecessorTemplateId,
      successorTemplateId: input.successorTemplateId,
      relationshipType: input.relationshipType,
      lag: input.lag ?? 0,
    },
  });
  await materializeTemplatesForAllDeliverables(fragnet.id, fragnet.companyId);
  return rel;
}

/** Deliverable is considered to have workflow if it has activities OR fragnet has templates to inherit. */
export async function deliverableHasEffectiveWorkflow(
  deliverable: Pick<Deliverable, "id" | "fragnetId" | "companyId">,
  activityCount: number
): Promise<boolean> {
  if (activityCount > 0) return true;
  if (!deliverable.fragnetId) return false;
  const templateCount = await countTemplatesForFragnet(deliverable.fragnetId, deliverable.companyId);
  return templateCount > 0;
}
