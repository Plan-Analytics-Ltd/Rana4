import type { Prisma, RelationshipType } from "@prisma/client";
import { prisma } from "../../utils/prisma.js";
import { auditLog } from "../audit.service.js";
import { createProfile, updateProfile } from "../intelligence/profiles/intelligenceProfile.service.js";
import { runWithAuthContextAsync } from "../../utils/requestContext.js";
import {
  buildXerEntityPlan,
  deliverableDurationFromActivities,
  type PlannedActivity,
} from "./xerEntityPlan.service.js";
import { captureBaselineSnapshotFromImport } from "../intelligence/shared/programmeSnapshotCapture.service.js";
import {
  buildRevisionDisplayLabel,
  extractProgrammeNameFromXerBuffer,
} from "../intelligence/shared/programmeIdentity.service.js";

export type XerProjectDetails = {
  name: string;
  clientType?: string | null;
  projectType?: string | null;
  stage?: string | null;
  complexity?: string | null;
  description?: string | null;
};

export type XerProjectImportResult = {
  projectId: string;
  projectName: string;
  baselineSnapshotId: string;
  created: {
    standards: number;
    fragnets: number;
    deliverables: number;
    activities: number;
    relationships: number;
  };
  skippedRelationships: number;
};

function normalize(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

function activityDuration(a: PlannedActivity): { best: number; likely: number } {
  const d = deliverableDurationFromActivities([a]);
  return { best: d.bestDuration, likely: d.likelyDuration };
}

export async function importProjectFromXer(
  buffer: Buffer,
  fileName: string,
  companyId: string,
  userId: string,
  details: XerProjectDetails
): Promise<XerProjectImportResult> {
  const nameStr = String(details.name ?? "").trim();
  if (!nameStr) throw Object.assign(new Error("Project name is required"), { status: 400 });

  const existing = await prisma.project.findFirst({
    where: { companyId, name: nameStr, archivedAt: null },
    select: { id: true },
  });
  if (existing) {
    throw Object.assign(new Error(`A project named "${nameStr}" already exists. Choose a different name.`), {
      status: 409,
    });
  }

  const plan = buildXerEntityPlan(buffer, fileName);

  return runWithAuthContextAsync({ userId, companyId }, async () => {
  const result = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: nameStr.slice(0, 255),
        companyId,
        scheduleStartDate: plan.scheduleStartDate ?? undefined,
      },
    });

    await tx.projectMember.create({
      data: { projectId: project.id, userId, role: "ADMIN" },
    });

    const standard = await tx.standard.create({
      data: {
        name: plan.standardName.slice(0, 255),
        description:
          details.description != null && String(details.description).trim()
            ? String(details.description).trim().slice(0, 2000)
            : `Imported from Primavera XER (${fileName})`,
        projectId: project.id,
        companyId,
      },
    });

    const fragnetByName = new Map<string, { id: string; name: string }>();
    let fragnetCount = 0;
    for (const f of plan.fragnets) {
      const created = await tx.fragnet.create({
        data: {
          standardId: standard.id,
          name: f.name.trim().slice(0, 255),
          description: null,
          projectId: project.id,
          companyId,
        },
      });
      fragnetByName.set(normalize(created.name), { id: created.id, name: created.name });
      fragnetCount += 1;
    }

    const deliverableIds: string[] = [];
    const deliverableByFragAndName = new Map<string, { id: string; fragnetId: string }>();
    let deliverableCount = 0;
    for (const f of plan.fragnets) {
      const frag = fragnetByName.get(normalize(f.name));
      if (!frag) continue;
      for (const d of f.deliverables) {
        const dur = deliverableDurationFromActivities(d.activities);
        const created = await tx.deliverable.create({
          data: {
            name: d.name.trim().slice(0, 255),
            bestDuration: dur.bestDuration,
            likelyDuration: dur.likelyDuration,
            fragnetId: frag.id,
            assignedResources: [] as Prisma.InputJsonValue,
            projectId: project.id,
            companyId,
          },
        });
        deliverableByFragAndName.set(`${normalize(frag.name)}||${normalize(created.name)}`, {
          id: created.id,
          fragnetId: frag.id,
        });
        deliverableIds.push(created.id);
        deliverableCount += 1;
      }
    }

    const activityByFragAndCode = new Map<string, { id: string; fragnetId: string }>();
    let activityCount = 0;

    for (const f of plan.fragnets) {
      const frag = fragnetByName.get(normalize(f.name));
      if (!frag) continue;
      for (const d of f.deliverables) {
        const delKey = `${normalize(frag.name)}||${normalize(d.name)}`;
        const del = deliverableByFragAndName.get(delKey);
        if (!del) continue;

        for (const a of d.activities) {
          const dur = activityDuration(a);
          const created = await tx.activity.create({
            data: {
              fragnetId: frag.id,
              deliverableId: del.id,
              projectId: project.id,
              companyId,
              activityCode: a.activityCode.trim().slice(0, 100),
              name: (a.name ?? a.activityCode).trim().slice(0, 255),
              bestDuration: dur.best,
              likelyDuration: dur.likely,
              assignedResources: [] as Prisma.InputJsonValue,
              plannedStartDate: a.startDate ?? undefined,
              plannedFinishDate: a.finishDate ?? undefined,
              earlyStart: a.earlyStart ?? undefined,
              earlyFinish: a.earlyFinish ?? undefined,
              lateStart: a.lateStart ?? undefined,
              lateFinish: a.lateFinish ?? undefined,
              totalFloat: a.totalFloatDays != null ? Math.round(a.totalFloatDays) : undefined,
              freeFloat: a.freeFloatDays != null ? Math.round(a.freeFloatDays) : undefined,
              isCritical: a.isCritical === true,
              p6TaskType: a.p6TaskType?.trim().slice(0, 32) || undefined,
            },
          });
          activityByFragAndCode.set(`${normalize(frag.name)}||${normalize(a.activityCode)}`, {
            id: created.id,
            fragnetId: frag.id,
          });
          activityCount += 1;
        }
      }
    }

    let relationshipCount = 0;
    let skippedRelationships = 0;
    const relDup = new Set<string>();

    for (const r of plan.relationships) {
      let placed = false;
      for (const [, frag] of fragnetByName) {
        const predKey = `${normalize(frag.name)}||${normalize(r.predecessorActivityCode)}`;
        const succKey = `${normalize(frag.name)}||${normalize(r.successorActivityCode)}`;
        const pred = activityByFragAndCode.get(predKey);
        const succ = activityByFragAndCode.get(succKey);
        if (!pred || !succ) continue;
        if (pred.fragnetId !== succ.fragnetId) continue;

        const edgeKey = `${pred.id}-${succ.id}-${r.relationshipType}`;
        if (relDup.has(edgeKey)) continue;
        relDup.add(edgeKey);

        await tx.relationship.create({
          data: {
            projectId: project.id,
            companyId,
            fragnetId: pred.fragnetId,
            predecessorActivityId: pred.id,
            successorActivityId: succ.id,
            relationshipType: r.relationshipType as RelationshipType,
            lag: r.lag ?? 0,
          },
        });
        relationshipCount += 1;
        placed = true;
        break;
      }
      if (!placed) skippedRelationships += 1;
    }

    return {
      projectId: project.id,
      projectName: project.name,
      deliverableIds,
      created: {
        standards: 1,
        fragnets: fragnetCount,
        deliverables: deliverableCount,
        activities: activityCount,
        relationships: relationshipCount,
      },
      skippedRelationships,
    };
  }, { maxWait: 30_000, timeout: 10 * 60_000 });

  const { materializeTemplatesForDeliverable } = await import("../fragnetActivityTemplate.service.js");
  for (const delId of result.deliverableIds) {
    await materializeTemplatesForDeliverable(delId, companyId);
  }

  const { deliverableIds: _deliverableIds, ...importResult } = result;

  await createProfile(importResult.projectId, companyId);
  if (details.clientType || details.projectType || details.stage || details.complexity) {
    await updateProfile(importResult.projectId, companyId, {
      clientType: details.clientType ?? null,
      projectType: details.projectType ?? null,
      stage: details.stage ?? null,
      complexity: details.complexity ?? null,
    });
  }

  const programmeDisplayName =
    extractProgrammeNameFromXerBuffer(buffer, fileName, nameStr) ?? nameStr;
  const baselineLabel = buildRevisionDisplayLabel({
    programmeDisplayName,
    snapshotVersion: 1,
    snapshotRole: "BASELINE",
    fallbackLabel: nameStr,
  });

  const liveActivities = await prisma.activity.findMany({
    where: { projectId: importResult.projectId, companyId },
    select: {
      id: true,
      activityCode: true,
      deliverableId: true,
      fragnetId: true,
      name: true,
    },
  });
  const liveDeliverables = await prisma.deliverable.findMany({
    where: { projectId: importResult.projectId, companyId },
    select: { id: true, name: true },
  });
  const liveRelationships = await prisma.relationship.findMany({
    where: { projectId: importResult.projectId, companyId },
    include: {
      predecessorActivity: { select: { activityCode: true } },
      successorActivity: { select: { activityCode: true } },
    },
  });

  const parsedByCode = new Map(
    plan.parsed.activities.map((a) => [a.activityCode.trim().toUpperCase(), a])
  );

  const baselineActivities = liveActivities.map((live) => {
    const row = parsedByCode.get(live.activityCode.trim().toUpperCase());
    return {
      activityCode: live.activityCode,
      activityId: live.id,
      deliverableId: live.deliverableId,
      fragnetId: live.fragnetId,
      name: row?.name ?? live.name,
      originalDurationDays: row?.originalDurationDays,
      remainingDurationDays: row?.remainingDurationDays,
      actualDurationDays: row?.actualDurationDays,
      percentComplete: row?.percentComplete,
      startDate: row?.startDate,
      finishDate: row?.finishDate,
      actualStart: row?.actualStart,
      actualFinish: row?.actualFinish,
      earlyStart: row?.earlyStart,
      earlyFinish: row?.earlyFinish,
      lateStart: row?.lateStart,
      lateFinish: row?.lateFinish,
      totalFloatDays: row?.totalFloatDays,
      freeFloatDays: row?.freeFloatDays,
      isCritical: row?.isCritical,
      status: row?.status,
      p6TaskType: row?.p6TaskType,
    };
  });

  const baseline = await captureBaselineSnapshotFromImport({
    projectId: importResult.projectId,
    companyId,
    userId,
    label: baselineLabel,
    sourceFileName: fileName,
    programmeDisplayName,
    scheduleDate: plan.scheduleStartDate,
    activities: baselineActivities,
    deliverables: liveDeliverables.map((d) => ({ name: d.name, deliverableId: d.id })),
    relationships: liveRelationships.map((r) => ({
      predecessorActivityCode: r.predecessorActivity.activityCode,
      successorActivityCode: r.successorActivity.activityCode,
      relationshipType: r.relationshipType,
      lag: r.lag,
      matchedRelationshipId: r.id,
    })),
    matchResult: {
      matchedActivities: baselineActivities.length,
      unmatchedActivityCodes: [],
      matchedDeliverables: liveDeliverables.length,
      unmatchedDeliverableNames: [],
      matchedRelationships: liveRelationships.length,
      unmatchedRelationships: 0,
    },
    metrics: plan.parsed.metrics,
  });

  await auditLog({
    userId,
    companyId,
    projectId: importResult.projectId,
    action: "CREATE_PROJECT_FROM_XER",
    entity: "Project",
    entityId: importResult.projectId,
    details: { fileName, baselineSnapshotId: baseline.snapshotId, ...importResult.created },
  });

  return { ...importResult, baselineSnapshotId: baseline.snapshotId };
  });
}
