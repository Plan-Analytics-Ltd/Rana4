import type { ParsedProgrammeImport } from "./types.js";

/** Rana4 programme round-trip format (version 1). */
export type Rana4ProgrammeExportV1 = {
  format: "rana4-programme";
  version: 1;
  exportedAt: string;
  projectId: string;
  projectName: string;
  scheduleStartDate: string | null;
  scheduleDate?: string;
  label?: string;
  activities: Array<{
    activityCode: string;
    activityId?: string;
    deliverableId?: string;
    fragnetId?: string;
    name?: string;
    bestDuration?: number;
    likelyDuration?: number;
    originalDurationDays?: number;
    remainingDurationDays?: number;
    actualDurationDays?: number;
    percentComplete?: number;
    plannedStartDate?: string;
    plannedFinishDate?: string;
    earlyStart?: string;
    earlyFinish?: string;
    lateStart?: string;
    lateFinish?: string;
    totalFloatDays?: number;
    freeFloatDays?: number;
    isCritical?: boolean;
    status?: string;
    p6TaskType?: string | null;
    classificationTags?: Record<string, string>;
  }>;
  deliverables: Array<{
    deliverableId?: string;
    name: string;
    plannedStart?: string;
    plannedFinish?: string;
    actualStart?: string;
    actualFinish?: string;
    totalFloatDays?: number;
    status?: string;
    classificationTags?: Record<string, string>;
  }>;
  relationships: Array<{
    predecessorActivityCode: string;
    successorActivityCode: string;
    relationshipType: string;
    lag: number;
  }>;
  metrics?: Record<string, unknown>;
};

function isoDate(d: Date | null | undefined): string | undefined {
  if (!d) return undefined;
  return d.toISOString().slice(0, 10);
}

export function buildRana4ProgrammeExport(args: {
  projectId: string;
  projectName: string;
  scheduleStartDate: Date | null;
  activities: Array<{
    id: string;
    activityCode: string;
    name: string;
    deliverableId: string;
    fragnetId: string;
    bestDuration: number;
    likelyDuration: number;
    plannedStartDate?: Date | null;
    plannedFinishDate?: Date | null;
    earlyStart?: Date | null;
    earlyFinish?: Date | null;
    lateStart?: Date | null;
    lateFinish?: Date | null;
    totalFloat?: number | null;
    freeFloat?: number | null;
    isCritical: boolean;
    status: string;
    p6TaskType?: string | null;
  }>;
  deliverables: Array<{
    id: string;
    name: string;
  }>;
  relationships: Array<{
    predecessorActivityCode: string;
    successorActivityCode: string;
    relationshipType: string;
    lag: number;
  }>;
}): Rana4ProgrammeExportV1 {
  return {
    format: "rana4-programme",
    version: 1,
    exportedAt: new Date().toISOString(),
    projectId: args.projectId,
    projectName: args.projectName,
    scheduleStartDate: isoDate(args.scheduleStartDate) ?? null,
    activities: args.activities.map((a) => ({
      activityCode: a.activityCode,
      activityId: a.id,
      deliverableId: a.deliverableId,
      fragnetId: a.fragnetId,
      name: a.name,
      bestDuration: a.bestDuration,
      likelyDuration: a.likelyDuration,
      originalDurationDays: a.likelyDuration,
      remainingDurationDays: a.likelyDuration,
      plannedStartDate: isoDate(a.plannedStartDate),
      plannedFinishDate: isoDate(a.plannedFinishDate),
      earlyStart: isoDate(a.earlyStart),
      earlyFinish: isoDate(a.earlyFinish),
      lateStart: isoDate(a.lateStart),
      lateFinish: isoDate(a.lateFinish),
      totalFloatDays: a.totalFloat ?? undefined,
      freeFloatDays: a.freeFloat ?? undefined,
      isCritical: a.isCritical,
      status: a.status,
      p6TaskType: a.p6TaskType ?? undefined,
    })),
    deliverables: args.deliverables.map((d) => ({ deliverableId: d.id, name: d.name })),
    relationships: args.relationships,
    metrics: { activityCount: args.activities.length },
  };
}

export function parseRana4ProgrammeJson(raw: string | Buffer): ParsedProgrammeImport {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
  const data = JSON.parse(text) as Rana4ProgrammeExportV1;
  if (data.format !== "rana4-programme" || data.version !== 1) {
    throw new Error("Unsupported Rana4 programme export format");
  }

  const parseDate = (s?: string) => (s ? new Date(s) : undefined);

  return {
    sourceType: "RANA4_EXPORT",
    scheduleDate: parseDate(data.scheduleDate),
    label: data.label,
    activities: (data.activities ?? []).map((a) => ({
      activityCode: a.activityCode,
      name: a.name,
      originalDurationDays: a.originalDurationDays ?? a.likelyDuration,
      remainingDurationDays: a.remainingDurationDays ?? a.likelyDuration,
      actualDurationDays: a.actualDurationDays,
      percentComplete: a.percentComplete,
      startDate: parseDate(a.plannedStartDate ?? a.earlyStart),
      finishDate: parseDate(a.plannedFinishDate ?? a.earlyFinish),
      earlyStart: parseDate(a.earlyStart),
      earlyFinish: parseDate(a.earlyFinish),
      lateStart: parseDate(a.lateStart),
      lateFinish: parseDate(a.lateFinish),
      totalFloatDays: a.totalFloatDays,
      freeFloatDays: a.freeFloatDays,
      isCritical: a.isCritical,
      status: a.status,
      p6TaskType: a.p6TaskType ?? undefined,
      classificationTags: a.classificationTags,
    })),
    deliverables: (data.deliverables ?? []).map((d) => ({
      name: d.name,
      plannedStart: parseDate(d.plannedStart),
      plannedFinish: parseDate(d.plannedFinish),
      actualStart: parseDate(d.actualStart),
      actualFinish: parseDate(d.actualFinish),
      totalFloatDays: d.totalFloatDays,
      status: d.status,
      classificationTags: d.classificationTags,
    })),
    relationships: (data.relationships ?? []).map((r) => ({
      predecessorActivityCode: r.predecessorActivityCode,
      successorActivityCode: r.successorActivityCode,
      relationshipType: r.relationshipType as ParsedProgrammeImport["relationships"][0]["relationshipType"],
      lag: r.lag ?? 0,
    })),
    metrics: data.metrics,
  };
}
