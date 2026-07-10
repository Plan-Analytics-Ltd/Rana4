import { prisma } from "../../../utils/prisma.js";
import { MS_PER_DAY, diffDaysFromDates } from "./intelligenceMath.js";

export type DurationSourceKind = "LIKELY_DURATION" | "BEST_DURATION" | "ACTIVITY_DATE_SPAN";

export type CurrentDurationSource = {
  durationDays: number | null;
  source: DurationSourceKind;
  sourceTable: "deliverables" | "activities";
  sourceFields: string[];
  definition: string;
};

/**
 * Canonical current duration for intelligence benchmarking.
 * Matches what planners see in the deliverables UI (Likely duration first).
 */
export async function resolveCurrentDeliverableDuration(args: {
  projectId: string;
  companyId: string;
  deliverableId: string;
}): Promise<CurrentDurationSource> {
  const deliverable = await prisma.deliverable.findFirst({
    where: {
      id: args.deliverableId,
      projectId: args.projectId,
      companyId: args.companyId,
    },
    select: { likelyDuration: true, bestDuration: true },
  });

  if (deliverable?.likelyDuration != null && deliverable.likelyDuration > 0) {
    return {
      durationDays: deliverable.likelyDuration,
      source: "LIKELY_DURATION",
      sourceTable: "deliverables",
      sourceFields: ["likelyDuration"],
      definition:
        "Current duration uses the deliverable Likely duration shown in the programme (planner estimate).",
    };
  }

  if (deliverable?.bestDuration != null && deliverable.bestDuration > 0) {
    return {
      durationDays: deliverable.bestDuration,
      source: "BEST_DURATION",
      sourceTable: "deliverables",
      sourceFields: ["bestDuration"],
      definition:
        "Current duration uses the deliverable Best duration because Likely duration was not set.",
    };
  }

  const activities = await prisma.activity.findMany({
    where: {
      projectId: args.projectId,
      companyId: args.companyId,
      OR: [
        { deliverableId: args.deliverableId },
        { deliverableLinks: { some: { deliverableId: args.deliverableId, companyId: args.companyId } } },
      ],
    },
    select: {
      plannedStartDate: true,
      plannedFinishDate: true,
      earlyStart: true,
      earlyFinish: true,
    },
  });

  let minStart: Date | null = null;
  let maxFinish: Date | null = null;
  for (const a of activities) {
    const s = a.plannedStartDate ?? a.earlyStart ?? null;
    const f = a.plannedFinishDate ?? a.earlyFinish ?? null;
    if (s && (!minStart || s.getTime() < minStart.getTime())) minStart = s;
    if (f && (!maxFinish || f.getTime() > maxFinish.getTime())) maxFinish = f;
  }

  if (minStart && maxFinish) {
    const days = Math.max(0, Math.round((maxFinish.getTime() - minStart.getTime()) / MS_PER_DAY));
    return {
      durationDays: days,
      source: "ACTIVITY_DATE_SPAN",
      sourceTable: "activities",
      sourceFields: ["plannedStartDate", "plannedFinishDate", "earlyStart", "earlyFinish"],
      definition:
        "Current duration derived from linked activity date spans because deliverable durations were not set.",
    };
  }

  return {
    durationDays: null,
    source: "LIKELY_DURATION",
    sourceTable: "deliverables",
    sourceFields: ["likelyDuration"],
    definition: "No current duration could be resolved from deliverable or activity data.",
  };
}

export type BaselineDurationSource = {
  durationDays: number | null;
  snapshotId: string | null;
  snapshotLabel: string | null;
  definition: string;
};

/**
 * Baseline duration from the first approved baseline deliverable snapshot on this project.
 * Used for planner-facing baseline vs current display — does not affect benchmark algorithms.
 */
export async function resolveBaselineDeliverableDuration(args: {
  projectId: string;
  companyId: string;
  deliverableId: string;
  deliverableName: string;
  fragnetId: string | null;
}): Promise<BaselineDurationSource> {
  const identityClause = args.fragnetId
    ? {
        OR: [
          { deliverableId: args.deliverableId },
          {
            AND: [
              { fragnetId: args.fragnetId },
              { name: { equals: args.deliverableName, mode: "insensitive" as const } },
            ],
          },
        ],
      }
    : { deliverableId: args.deliverableId };

  const row = await prisma.deliverableSnapshot.findFirst({
    where: {
      snapshot: {
        projectId: args.projectId,
        companyId: args.companyId,
        programmeState: "APPROVED_BASELINE",
      },
      ...identityClause,
    },
    orderBy: { snapshot: { importedAt: "asc" } },
    select: {
      workPackageDurationDays: true,
      plannedStart: true,
      plannedFinish: true,
      actualStart: true,
      actualFinish: true,
      snapshot: { select: { id: true, label: true, snapshotVersion: true, importSummary: true } },
    },
  });

  if (!row) {
    return {
      durationDays: null,
      snapshotId: null,
      snapshotLabel: null,
      definition: "No approved baseline snapshot found for this deliverable.",
    };
  }

  let durationDays: number | null = null;
  if (row.workPackageDurationDays != null && Number.isFinite(row.workPackageDurationDays)) {
    durationDays = Math.round(row.workPackageDurationDays);
  } else {
    durationDays = diffDaysFromDates(
      row.actualStart ?? row.plannedStart,
      row.actualFinish ?? row.plannedFinish
    );
  }

  const summary = row.snapshot.importSummary as Record<string, unknown> | undefined;
  const label =
    String(summary?.programmeDisplayName ?? "").trim() ||
    row.snapshot.label?.trim() ||
    `Revision ${row.snapshot.snapshotVersion}`;

  return {
    durationDays,
    snapshotId: row.snapshot.id,
    snapshotLabel: label,
    definition: "Baseline duration from the approved baseline programme import for this deliverable.",
  };
}

export type DeliverableDurationView = {
  current: CurrentDurationSource;
  baseline: BaselineDurationSource;
};

export async function resolveDeliverableDurationView(args: {
  projectId: string;
  companyId: string;
  deliverableId: string;
}): Promise<DeliverableDurationView> {
  const deliverable = await prisma.deliverable.findFirst({
    where: {
      id: args.deliverableId,
      projectId: args.projectId,
      companyId: args.companyId,
    },
    select: { name: true, fragnetId: true },
  });

  const [current, baseline] = await Promise.all([
    resolveCurrentDeliverableDuration(args),
    deliverable
      ? resolveBaselineDeliverableDuration({
          ...args,
          deliverableName: deliverable.name,
          fragnetId: deliverable.fragnetId,
        })
      : Promise.resolve({
          durationDays: null,
          snapshotId: null,
          snapshotLabel: null,
          definition: "Deliverable not found.",
        } as BaselineDurationSource),
  ]);

  return { current, baseline };
}
