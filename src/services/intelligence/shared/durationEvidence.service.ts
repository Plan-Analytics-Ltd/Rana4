import type { DeliverableClassification } from "@prisma/client";
import { prisma } from "../../../utils/prisma.js";
import { ALLOWED_SNAPSHOT_STATES } from "./intelligenceConstants.js";
import { diffDaysFromDates, round1 } from "./intelligenceMath.js";

export { ALLOWED_SNAPSHOT_STATES };

const diffDays = diffDaysFromDates;

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

export { round1 } from "./intelligenceMath.js";

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

export type HistoricalDurationSampleWithMeta = HistoricalDurationSample & {
  classification: string;
  projectType?: string | null;
  stage?: string | null;
  complexity?: string | null;
  procurementRoute?: string | null;
  clientType?: string | null;
};

function normMatch(value: string | null | undefined, filter: string | null | undefined): boolean {
  if (!filter) return true;
  const f = String(filter).trim().toLowerCase();
  const v = String(value ?? "").trim().toLowerCase();
  return v === f;
}

function filterDurationSamples(
  samples: HistoricalDurationSampleWithMeta[],
  filters: DurationEvidenceFilters
): HistoricalDurationSample[] {
  const classification = String(filters.classification);
  const out: HistoricalDurationSample[] = [];
  for (const s of samples) {
    if (s.classification !== classification) continue;
    if (!normMatch(s.projectType, filters.projectType)) continue;
    if (!normMatch(s.stage, filters.stage)) continue;
    if (!normMatch(s.complexity, filters.complexity)) continue;
    if (!normMatch(s.procurementRoute, filters.procurementRoute)) continue;
    if (!normMatch(s.clientType, filters.clientType)) continue;
    out.push({ durationDays: s.durationDays, projectId: s.projectId, snapshotId: s.snapshotId });
  }
  return out;
}

/** Load all historical duration samples for a company in one snapshot query. */
export async function loadCompanyHistoricalDurationSamples(args: {
  companyId: string;
  projectIds?: string[];
  excludeProjectId?: string;
}): Promise<HistoricalDurationSampleWithMeta[]> {
  const snapshots = await prisma.programmeSnapshot.findMany({
    where: {
      companyId: args.companyId,
      programmeState: { in: ALLOWED_SNAPSHOT_STATES },
      project: { archivedAt: null },
      ...(args.excludeProjectId ? { projectId: { not: args.excludeProjectId } } : {}),
      ...(args.projectIds && args.projectIds.length > 0 ? { projectId: { in: args.projectIds } } : {}),
    },
    include: {
      deliverableSnapshots: true,
      project: { include: { intelligenceProfile: true } },
    },
    orderBy: { importedAt: "desc" },
    take: 500,
  });

  const out: HistoricalDurationSampleWithMeta[] = [];
  for (const snap of snapshots) {
    const profile = snap.project.intelligenceProfile;
    const meta = {
      projectType: snap.projectType ?? profile?.projectType,
      stage: snap.stage ?? profile?.stage ?? profile?.primaryRibaStage,
      complexity: snap.complexity ?? profile?.complexity,
      procurementRoute: snap.procurementRoute ?? profile?.procurementRoute,
      clientType: snap.clientType ?? profile?.clientType,
    };
    for (const d of snap.deliverableSnapshots) {
      const durationActual = diffDays(d.actualStart, d.actualFinish);
      const durationPlanned = diffDays(d.plannedStart, d.plannedFinish);
      const durationDays = durationActual ?? durationPlanned;
      if (durationDays == null || !Number.isFinite(durationDays)) continue;
      out.push({
        durationDays,
        projectId: snap.projectId,
        snapshotId: snap.id,
        classification: String(d.classification ?? "OTHER"),
        ...meta,
      });
    }
  }
  return out;
}

export async function loadHistoricalDeliverableDurations(args: {
  companyId: string;
  filters: DurationEvidenceFilters;
  projectIds?: string[];
  excludeProjectId?: string;
  preloadedSamples?: HistoricalDurationSampleWithMeta[];
}): Promise<HistoricalDurationSample[]> {
  const samples =
    args.preloadedSamples ??
    (await loadCompanyHistoricalDurationSamples({
      companyId: args.companyId,
      projectIds: args.projectIds,
      excludeProjectId: args.excludeProjectId,
    }));
  return filterDurationSamples(samples, args.filters);
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
