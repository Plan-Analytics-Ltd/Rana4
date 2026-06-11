import type { DeliverableClassification, ProgrammeState } from "@prisma/client";
import { prisma } from "../../utils/prisma.js";

const ALLOWED_SNAPSHOT_STATES: ProgrammeState[] = ["APPROVED_BASELINE", "AS_BUILT", "FINAL_AS_BUILT"];

function msPerDay() {
  return 24 * 60 * 60 * 1000;
}

function diffDays(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  const d = (b.getTime() - a.getTime()) / msPerDay();
  if (!Number.isFinite(d)) return null;
  return Math.max(0, Math.round(d));
}

export function median(sorted: number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const pp = Math.max(0, Math.min(1, p));
  const idx = (sorted.length - 1) * pp;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

export function stddev(values: number[], mean: number): number | null {
  if (values.length < 2) return null;
  const v = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export type DurationEvidenceFilters = {
  classification: DeliverableClassification | string;
  projectType?: string | null;
  stage?: string | null;
  complexity?: string | null;
  procurementRoute?: string | null;
  clientType?: string | null;
};

export type HistoricalDurationSample = {
  durationDays: number;
  projectId: string;
  snapshotId: string;
};

function normMatch(value: string | null | undefined, filter: string | null | undefined): boolean {
  if (!filter) return true;
  const f = String(filter).trim().toLowerCase();
  const v = String(value ?? "").trim().toLowerCase();
  return v === f;
}

export async function loadHistoricalDeliverableDurations(args: {
  companyId: string;
  filters: DurationEvidenceFilters;
  projectIds?: string[];
  excludeProjectId?: string;
}): Promise<HistoricalDurationSample[]> {
  const classification = String(args.filters.classification);
  const snapshots = await prisma.programmeSnapshot.findMany({
    where: {
      companyId: args.companyId,
      programmeState: { in: ALLOWED_SNAPSHOT_STATES },
      project: { archivedAt: null },
      ...(args.excludeProjectId ? { projectId: { not: args.excludeProjectId } } : {}),
      ...(args.projectIds && args.projectIds.length > 0 ? { projectId: { in: args.projectIds } } : {}),
    },
    include: {
      deliverableSnapshots: {
        where: { classification: classification as DeliverableClassification },
      },
      project: { include: { intelligenceProfile: true } },
    },
    orderBy: { importedAt: "desc" },
    take: 500,
  });

  const out: HistoricalDurationSample[] = [];
  for (const snap of snapshots) {
    const profile = snap.project.intelligenceProfile;
    const meta = {
      projectType: snap.projectType ?? profile?.projectType,
      stage: snap.stage ?? profile?.stage ?? profile?.primaryRibaStage,
      complexity: snap.complexity ?? profile?.complexity,
      procurementRoute: snap.procurementRoute ?? profile?.procurementRoute,
      clientType: snap.clientType ?? profile?.clientType,
    };
    if (!normMatch(meta.projectType, args.filters.projectType)) continue;
    if (!normMatch(meta.stage, args.filters.stage)) continue;
    if (!normMatch(meta.complexity, args.filters.complexity)) continue;
    if (!normMatch(meta.procurementRoute, args.filters.procurementRoute)) continue;
    if (!normMatch(meta.clientType, args.filters.clientType)) continue;

    for (const d of snap.deliverableSnapshots) {
      const durationActual = diffDays(d.actualStart, d.actualFinish);
      const durationPlanned = diffDays(d.plannedStart, d.plannedFinish);
      const durationDays = durationActual ?? durationPlanned;
      if (durationDays == null || !Number.isFinite(durationDays)) continue;
      out.push({ durationDays, projectId: snap.projectId, snapshotId: snap.id });
    }
  }
  return out;
}

export function formatClassificationLabel(classification: string): string {
  return classification.replace(/_/g, " ");
}

export type PlannedVsActualSample = {
  plannedDays: number;
  actualDays: number;
  varianceDays: number;
  variancePercent: number;
  projectId: string;
  snapshotId: string;
  classification: string;
};

/** Load deliverable snapshots where both planned and actual date spans exist. */
export async function loadPlannedVsActualSamples(args: {
  companyId: string;
  classification?: DeliverableClassification | string;
}): Promise<PlannedVsActualSample[]> {
  const snapshots = await prisma.programmeSnapshot.findMany({
    where: {
      companyId: args.companyId,
      programmeState: { in: ALLOWED_SNAPSHOT_STATES },
      project: { archivedAt: null },
    },
    include: {
      deliverableSnapshots: args.classification
        ? { where: { classification: args.classification as DeliverableClassification } }
        : true,
    },
    orderBy: { importedAt: "desc" },
    take: 500,
  });

  const out: PlannedVsActualSample[] = [];
  for (const snap of snapshots) {
    for (const d of snap.deliverableSnapshots) {
      const plannedDays = diffDays(d.plannedStart, d.plannedFinish);
      const actualDays = diffDays(d.actualStart, d.actualFinish);
      if (plannedDays == null || actualDays == null || plannedDays <= 0) continue;
      const varianceDays = actualDays - plannedDays;
      const variancePercent = (varianceDays / plannedDays) * 100;
      out.push({
        plannedDays,
        actualDays,
        varianceDays,
        variancePercent,
        projectId: snap.projectId,
        snapshotId: snap.id,
        classification: String(d.classification ?? "OTHER"),
      });
    }
  }
  return out;
}
