import type { ProgrammeSnapshotRole, ProgrammeSnapshotSourceType } from "@prisma/client";
import { prisma } from "../../utils/prisma.js";
import { parseRana4ProgrammeJson } from "./rana4ScheduleExport.service.js";
import { captureProgrammeSnapshot } from "./programmeSnapshotCapture.service.js";
import { enrichActivityRowsWithClassifications } from "./intelligenceMetadata.service.js";
import { autoClassifyDeliverablesForProject } from "./deliverableClassification.service.js";
import { parseXerProgramme } from "./xerParse.service.js";
import type { ParsedProgrammeImport, ProgrammeImportMatchResult, SnapshotSummary } from "./types.js";

export type ProgrammeImportOptions = {
  projectId: string;
  companyId: string;
  userId?: string;
  sourceFileName?: string;
  snapshotRole?: ProgrammeSnapshotRole;
  label?: string;
  /** Override auto-detected source type */
  sourceType?: ProgrammeSnapshotSourceType;
};

function detectFormat(fileName: string, buffer: Buffer): "xer" | "json" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xer")) return "xer";
  if (lower.endsWith(".json")) return "json";
  const head = buffer.slice(0, 200).toString("utf8").trim();
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (head.includes("%T\tTASK") || head.startsWith("ERMHDR")) return "xer";
  throw new Error("Unsupported file format. Use .xer or Rana4 programme .json export.");
}

function parseImportBuffer(fileName: string, buffer: Buffer): ParsedProgrammeImport {
  const fmt = detectFormat(fileName, buffer);
  if (fmt === "xer") return parseXerProgramme(buffer);
  return parseRana4ProgrammeJson(buffer);
}

async function loadProjectIdentityMaps(projectId: string, companyId: string) {
  const activities = await prisma.activity.findMany({
    where: { projectId, companyId },
    select: {
      id: true,
      activityCode: true,
      deliverableId: true,
      fragnetId: true,
      name: true,
    },
  });

  const deliverables = await prisma.deliverable.findMany({
    where: { projectId, companyId },
    select: { id: true, name: true },
  });

  const relationships = await prisma.relationship.findMany({
    where: { projectId, companyId },
    include: {
      predecessorActivity: { select: { activityCode: true } },
      successorActivity: { select: { activityCode: true } },
    },
  });

  const activityByCode = new Map<string, (typeof activities)[0]>();
  for (const a of activities) {
    const key = a.activityCode.trim().toUpperCase();
    if (!activityByCode.has(key)) activityByCode.set(key, a);
  }

  const deliverableByName = new Map<string, string>();
  for (const d of deliverables) {
    deliverableByName.set(d.name.trim().toLowerCase(), d.id);
  }

  const relByKey = new Map<string, string>();
  for (const r of relationships) {
    const key = `${r.predecessorActivity.activityCode}\x1d${r.successorActivity.activityCode}\x1d${r.relationshipType}`;
    relByKey.set(key.toUpperCase(), r.id);
  }

  return { activityByCode, deliverableByName, relByKey, activities, deliverables };
}

function matchImportToProject(
  parsed: ParsedProgrammeImport,
  maps: Awaited<ReturnType<typeof loadProjectIdentityMaps>>
): {
  activities: Array<ParsedProgrammeImport["activities"][0] & {
    activityId?: string;
    deliverableId?: string;
    fragnetId?: string;
  }>;
  deliverables: Array<ParsedProgrammeImport["deliverables"][0] & { deliverableId?: string }>;
  relationships: ParsedProgrammeImport["relationships"];
  matchResult: ProgrammeImportMatchResult;
} {
  const unmatchedActivityCodes: string[] = [];
  let matchedActivities = 0;

  const activities = parsed.activities.map((row) => {
    const live = maps.activityByCode.get(row.activityCode.trim().toUpperCase());
    if (live) {
      matchedActivities++;
      return {
        ...row,
        activityId: live.id,
        deliverableId: live.deliverableId,
        fragnetId: live.fragnetId,
        name: row.name ?? live.name,
      };
    }
    unmatchedActivityCodes.push(row.activityCode);
    return { ...row };
  });

  const unmatchedDeliverableNames: string[] = [];
  let matchedDeliverables = 0;
  const deliverables =
    parsed.deliverables.length > 0
      ? parsed.deliverables.map((d) => {
          const id = maps.deliverableByName.get(d.name.trim().toLowerCase());
          if (id) {
            matchedDeliverables++;
            return { ...d, deliverableId: id };
          }
          unmatchedDeliverableNames.push(d.name);
          return { ...d };
        })
      : maps.deliverables.map((d) => ({
          name: d.name,
          deliverableId: d.id,
        }));

  if (parsed.deliverables.length === 0) {
    matchedDeliverables = maps.deliverables.length;
  }

  let matchedRelationships = 0;
  let unmatchedRelationships = 0;
  const relationships = parsed.relationships.map((r) => {
    const key = `${r.predecessorActivityCode}\x1d${r.successorActivityCode}\x1d${r.relationshipType}`.toUpperCase();
    const matchedId = maps.relByKey.get(key);
    if (matchedId) {
      matchedRelationships++;
      return { ...r, matchedRelationshipId: matchedId };
    }
    unmatchedRelationships++;
    return { ...r };
  });

  return {
    activities,
    deliverables,
    relationships,
    matchResult: {
      matchedActivities,
      unmatchedActivityCodes,
      matchedDeliverables,
      unmatchedDeliverableNames,
      matchedRelationships,
      unmatchedRelationships,
    },
  };
}

/**
 * Import live/as-built programme into historical snapshot layer.
 * Does NOT overwrite the live schedule.
 */
export async function importProgrammeSchedule(
  buffer: Buffer,
  fileName: string,
  options: ProgrammeImportOptions
): Promise<{ snapshotId: string; summary: SnapshotSummary; matchResult: ProgrammeImportMatchResult }> {
  const parsed = parseImportBuffer(fileName, buffer);
  const maps = await loadProjectIdentityMaps(options.projectId, options.companyId);
  let { activities, deliverables, relationships, matchResult } = matchImportToProject(parsed, maps);

  const matchedIds = activities.map((a) => a.activityId).filter((id): id is string => !!id);
  const tagMap = await enrichActivityRowsWithClassifications(
    options.projectId,
    options.companyId,
    matchedIds
  );
  activities = activities.map((a) => ({
    ...a,
    classificationTags: a.activityId ? tagMap.get(a.activityId) ?? a.classificationTags : a.classificationTags,
  }));

  let sourceType = options.sourceType ?? parsed.sourceType;
  if (options.snapshotRole === "AS_BUILT") sourceType = "AS_BUILT";
  else if (options.snapshotRole === "LIVE_IMPORT") sourceType = "LIVE_UPDATE";

  const { snapshotId, summary } = await captureProgrammeSnapshot({
    projectId: options.projectId,
    companyId: options.companyId,
    userId: options.userId,
    sourceType,
    snapshotRole: options.snapshotRole ?? "LIVE_IMPORT",
    scheduleDate: parsed.scheduleDate,
    label: options.label ?? parsed.label ?? `Import ${new Date().toISOString().slice(0, 10)}`,
    sourceFileName: options.sourceFileName ?? fileName,
    metrics: parsed.metrics,
    activities,
    deliverables,
    relationships,
    matchResult,
  });

  // Auto-classify live deliverables (manual override always wins).
  await autoClassifyDeliverablesForProject(options.projectId, options.companyId);

  return { snapshotId, summary, matchResult };
}
