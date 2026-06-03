import type { Deliverable, Fragnet, FragnetActivityTemplate, Prisma, RelationshipType } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import {
  copyTemplateCodesToActivity,
  replaceActivityCodeAssignmentsForTemplate,
} from "./activityCodeAssignments.service.js";
import { parseAndValidateAssignedResources } from "./rateCard.js";
import {
  allocateSequentialCodes,
  detectProjectCodePrefix,
  listProjectActivityCodes,
  maxSequenceInProject,
  parseActivityCode,
  resolveSequentialActivityCode,
} from "./activityCodeSequence.service.js";
import { syncActivityDeliverableLinks } from "./activityDeliverableLinks.service.js";
import { propagateDeliverableRelationshipsForFragnet } from "./deliverableRelationshipPropagation.service.js";

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

/** Planner-visible code: {DELIVERABLE_PREFIX}-{shortCode} — unique per deliverable instance. */
export function resolvePlannerActivityCode(
  deliverable: { id: string; name: string },
  userCode: string
): string {
  const trimmed = userCode.trim().replace(/\s+/g, "_");
  const prefix = deliverableActivityCodePrefix(deliverable);
  const pref = `${prefix}-`.toUpperCase();
  if (trimmed.toUpperCase().startsWith(pref)) return trimmed.slice(0, 100);
  return buildMaterializedActivityCode(prefix, trimmed);
}

/**
 * Re-number all activities in a project: A1001, A1002, … across fragnets and deliverables.
 */
export async function realignProjectActivityCodes(
  projectId: string,
  companyId: string
): Promise<{ updated: number }> {
  const fragnets = await prisma.fragnet.findMany({
    where: { projectId, companyId },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    select: { id: true },
  });

  const templatesByFragnet = new Map<string, Map<string, number>>();
  for (const f of fragnets) {
    const templates = await prisma.fragnetActivityTemplate.findMany({
      where: { fragnetId: f.id, companyId },
      select: { id: true, orderIndex: true },
    });
    templatesByFragnet.set(
      f.id,
      new Map(templates.map((t) => [t.id, t.orderIndex]))
    );
  }

  type OrderedAct = {
    id: string;
    fragnetId: string;
    activityCode: string;
    templateActivityId: string | null;
    deliverableCreatedAt: Date;
    createdAt: Date;
    templateOrder: number;
  };

  const ordered: OrderedAct[] = [];

  for (const f of fragnets) {
    const deliverables = await prisma.deliverable.findMany({
      where: { fragnetId: f.id, companyId },
      select: {
        id: true,
        createdAt: true,
        activities: { select: { activityCode: true } },
      },
    });
    const orderedDeliverables = [...deliverables].sort((a, b) => {
      const min = (acts: { activityCode: string }[]) => {
        let m = Number.POSITIVE_INFINITY;
        for (const x of acts) {
          const p = parseActivityCode(x.activityCode);
          if (p && p.number < m) m = p.number;
        }
        return m;
      };
      const ma = min(a.activities);
      const mb = min(b.activities);
      if (ma !== mb) return ma - mb;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const templateOrder = templatesByFragnet.get(f.id) ?? new Map();
    for (const d of orderedDeliverables) {
      const activities = await prisma.activity.findMany({
        where: { deliverableId: d.id, companyId, fragnetId: f.id },
        select: {
          id: true,
          fragnetId: true,
          activityCode: true,
          templateActivityId: true,
          createdAt: true,
        },
      });
      for (const a of activities) {
        ordered.push({
          ...a,
          deliverableCreatedAt: d.createdAt,
          templateOrder: a.templateActivityId
            ? (templateOrder.get(a.templateActivityId) ?? 9999)
            : 9999,
        });
      }
    }
  }

  ordered.sort((a, b) => {
    const fi = fragnets.findIndex((f) => f.id === a.fragnetId) - fragnets.findIndex((f) => f.id === b.fragnetId);
    if (fi !== 0) return fi;
    const dc = a.deliverableCreatedAt.getTime() - b.deliverableCreatedAt.getTime();
    if (dc !== 0) return dc;
    if (a.templateOrder !== b.templateOrder) return a.templateOrder - b.templateOrder;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const codes = ordered.map((a) => a.activityCode);
  const { detectProjectCodePrefix, formatActivityCode } = await import("./activityCodeSequence.service.js");
  const prefix = detectProjectCodePrefix(codes);

  let updated = 0;
  let seq = 1001;
  for (const a of ordered) {
    const target = formatActivityCode(prefix, seq);
    seq++;
    if (a.activityCode === target) continue;
    await prisma.activity.update({
      where: { id: a.id },
      data: { activityCode: target },
    });
    updated++;
  }
  return { updated };
}

/** @deprecated Use realignProjectActivityCodes — kept for API route name. */
export async function realignFragnetActivityCodes(
  fragnetId: string,
  companyId: string
): Promise<{ updated: number }> {
  const fragnet = await prisma.fragnet.findFirst({
    where: { id: fragnetId, companyId },
    select: { projectId: true },
  });
  if (!fragnet) return { updated: 0 };
  return realignProjectActivityCodes(fragnet.projectId, companyId);
}

export async function uniqueActivityCode(
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
/** SHARED path only — one activity row per template per fragnet; uses activity_deliverables. */
async function materializeSharedTemplateForDeliverable(args: {
  template: FragnetActivityTemplate;
  deliverable: Deliverable;
  fragnet: Fragnet;
  companyId: string;
  preassignedCodes?: string[];
  preassignedIndex: { value: number };
}): Promise<{ activityId: string; created: number }> {
  const { template: t, deliverable, fragnet, companyId, preassignedCodes, preassignedIndex } = args;

  const existingShared = await prisma.activity.findFirst({
    where: {
      companyId,
      projectId: deliverable.projectId,
      fragnetId: fragnet.id,
      templateActivityId: t.id,
      isSharedAcrossDeliverables: true,
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (existingShared) {
    return { activityId: existingShared.id, created: 0 };
  }

  const activityCode =
    preassignedCodes?.[preassignedIndex.value] ??
    (await allocateSequentialCodes(deliverable.projectId, companyId, 1))[0]!;
  preassignedIndex.value++;

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
      isSharedAcrossDeliverables: true,
      isInherited: true,
      templateActivityId: t.id,
      detachedFromTemplate: false,
    },
  });
  await copyTemplateCodesToActivity({
    companyId,
    templateActivityId: t.id,
    activityId: row.id,
  });
  await syncActivityDeliverableLinks({
    activityId: row.id,
    primaryDeliverableId: deliverable.id,
    deliverableIds: [deliverable.id],
    projectId: deliverable.projectId,
    companyId,
  });
  return { activityId: row.id, created: 1 };
}

/** NON-SHARED path only — one new activity row per deliverable; never uses junction links. */
async function materializeNonSharedTemplateForDeliverable(args: {
  template: FragnetActivityTemplate;
  deliverable: Deliverable;
  fragnet: Fragnet;
  companyId: string;
  preassignedCodes?: string[];
  preassignedIndex: { value: number };
}): Promise<{ activityId: string; created: number }> {
  const { template: t, deliverable, fragnet, companyId, preassignedCodes, preassignedIndex } = args;

  const existing = await prisma.activity.findFirst({
    where: {
      deliverableId: deliverable.id,
      companyId,
      templateActivityId: t.id,
      isSharedAcrossDeliverables: false,
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (existing) {
    return { activityId: existing.id, created: 0 };
  }

  const activityCode =
    preassignedCodes?.[preassignedIndex.value] ??
    (await allocateSequentialCodes(deliverable.projectId, companyId, 1))[0]!;
  preassignedIndex.value++;

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
      isSharedAcrossDeliverables: false,
      isInherited: true,
      templateActivityId: t.id,
      detachedFromTemplate: false,
    },
  });
  await copyTemplateCodesToActivity({
    companyId,
    templateActivityId: t.id,
    activityId: row.id,
  });
  return { activityId: row.id, created: 1 };
}

export async function materializeTemplatesForDeliverable(
  deliverableId: string,
  companyId: string,
  preassignedCodes?: string[]
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

  let created = 0;
  const byTemplateId = new Map<string, string>();
  const preassignedIndex = { value: 0 };

  for (const t of templates) {
    if (t.isSharedAcrossDeliverables) {
      const shared = await materializeSharedTemplateForDeliverable({
        template: t,
        deliverable,
        fragnet,
        companyId,
        preassignedCodes,
        preassignedIndex,
      });
      byTemplateId.set(t.id, shared.activityId);
      created += shared.created;
      continue;
    }

    const nonShared = await materializeNonSharedTemplateForDeliverable({
      template: t,
      deliverable,
      fragnet,
      companyId,
      preassignedCodes,
      preassignedIndex,
    });
    byTemplateId.set(t.id, nonShared.activityId);
    created += nonShared.created;
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

  await propagateDeliverableRelationshipsForFragnet(fragnet.id, companyId);

  const { syncDeliverableActivityLinkage } = await import("./deliverableActivityChain.service.js");
  await syncDeliverableActivityLinkage(deliverableId, companyId);

  return { created, relationships };
}

/**
 * Materialize empty deliverables in project order (fragnets → deliverables by activity ID)
 * with one continuous A1001, A1002, … sequence.
 */
export async function materializeProjectDeliverablesInOrder(
  projectId: string,
  companyId: string,
  limitFragnetId?: string
): Promise<{ activities: number; relationships: number }> {
  const fragnets = await prisma.fragnet.findMany({
    where: {
      projectId,
      companyId,
      ...(limitFragnetId ? { id: limitFragnetId } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    select: { id: true },
  });

  const prefix = detectProjectCodePrefix(await listProjectActivityCodes(projectId, companyId));
  let seq = Math.max(1001, (await maxSequenceInProject(projectId, companyId, prefix)) + 1);
  let activities = 0;
  let relationships = 0;

  for (const f of fragnets) {
    const templateCount = await prisma.fragnetActivityTemplate.count({
      where: { fragnetId: f.id, companyId },
    });
    if (templateCount === 0) continue;

    const deliverables = await prisma.deliverable.findMany({
      where: { fragnetId: f.id, companyId },
      select: {
        id: true,
        createdAt: true,
        activities: { select: { activityCode: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const ordered = [...deliverables].sort((a, b) => {
      const min = (acts: { activityCode: string }[]) => {
        let m = Number.POSITIVE_INFINITY;
        for (const x of acts) {
          const p = parseActivityCode(x.activityCode);
          if (p && p.number < m) m = p.number;
        }
        return m;
      };
      const ma = min(a.activities);
      const mb = min(b.activities);
      if (ma !== mb) return ma - mb;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    for (const d of ordered) {
      const r = await materializeTemplatesForDeliverable(d.id, companyId);
      activities += r.created;
      relationships += r.relationships;

      for (let i = 0; i < r.created; i++) {
        seq++;
      }
    }

    await propagateDeliverableRelationshipsForFragnet(f.id, companyId);
  }

  return { activities, relationships };
}

/** Materialize templates for every deliverable on a fragnet (e.g. after new template added). */
export async function materializeTemplatesForAllDeliverables(
  fragnetId: string,
  companyId: string
): Promise<{ deliverables: number; activities: number; relationships: number; codesRealigned: number }> {
  const fragnet = await prisma.fragnet.findFirst({
    where: { id: fragnetId, companyId },
    select: { projectId: true },
  });
  if (!fragnet) {
    return { deliverables: 0, activities: 0, relationships: 0, codesRealigned: 0 };
  }
  const deliverables = await prisma.deliverable.findMany({
    where: { fragnetId, companyId },
    select: {
      id: true,
      createdAt: true,
      activities: { select: { activityCode: true }, orderBy: { activityCode: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  let activities = 0;
  let relationships = 0;
  const r = await materializeProjectDeliverablesInOrder(fragnet.projectId, companyId, fragnetId);
  return {
    deliverables: deliverables.length,
    activities: r.activities,
    relationships: r.relationships,
    codesRealigned: 0,
  };
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

export async function plannerActivityCodeForDeliverable(
  fragnetId: string,
  companyId: string,
  deliverable: { id: string; name: string; projectId: string },
  userCode: string
): Promise<string> {
  return resolveSequentialActivityCode({
    projectId: deliverable.projectId,
    companyId,
    fragnetId,
    userCode,
  });
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
    isSharedAcrossDeliverables?: boolean;
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
      isSharedAcrossDeliverables: Boolean(input.isSharedAcrossDeliverables),
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
