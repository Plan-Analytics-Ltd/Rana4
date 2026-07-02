import type { ProgrammeSnapshotRole, ProgrammeState } from "@prisma/client";
import { fingerprintCacheKey, type DeliverableFingerprint } from "./deliverableFingerprint.service.js";

export type HistoricalRevision = {
  snapshotId: string;
  snapshotVersion: number;
  snapshotRole: ProgrammeSnapshotRole | null;
  programmeState: ProgrammeState | null;
  projectId: string;
  deliverableId: string | null;
  deliverableName: string;
  importedAt: Date;
  durationDays: number | null;
  fingerprintKey: string;
};

export type HistoricalDeliverable = {
  projectId: string;
  deliverableId: string | null;
  deliverableName: string;
  fingerprintKey: string;
  revisions: HistoricalRevision[];
};

export type HistoricalProject = {
  projectId: string;
  projectName: string;
  deliverables: HistoricalDeliverable[];
  revisionCount: number;
  completedRevisionCount: number;
};

const COMPLETED_STATES: ProgrammeState[] = ["AS_BUILT", "FINAL_AS_BUILT"];

function revisionPriority(state: ProgrammeState | null): number {
  if (state === "FINAL_AS_BUILT") return 5;
  if (state === "AS_BUILT") return 4;
  if (state === "APPROVED_BASELINE") return 3;
  if (state === "LIVE_UPDATE") return 2;
  if (state === "BASELINE") return 1;
  return 0;
}

/** Group flat revision rows into project → deliverable → revisions. */
export function groupHistoricalRevisions(
  rows: Array<{
    snapshotId: string;
    snapshotVersion: number;
    snapshotRole: ProgrammeSnapshotRole | null;
    programmeState: ProgrammeState | null;
    projectId: string;
    projectName: string;
    deliverableId: string | null;
    deliverableName: string;
    importedAt: Date;
    durationDays: number | null;
    fingerprint: DeliverableFingerprint;
  }>
): HistoricalProject[] {
  const byProject = new Map<string, HistoricalProject>();

  for (const row of rows) {
    const fpKey = fingerprintCacheKey(row.fingerprint);
    let project = byProject.get(row.projectId);
    if (!project) {
      project = {
        projectId: row.projectId,
        projectName: row.projectName,
        deliverables: [],
        revisionCount: 0,
        completedRevisionCount: 0,
      };
      byProject.set(row.projectId, project);
    }

    project.revisionCount += 1;
    if (row.programmeState && COMPLETED_STATES.includes(row.programmeState)) {
      project.completedRevisionCount += 1;
    }

    let deliverable = project.deliverables.find(
      (d) =>
        (row.deliverableId && d.deliverableId === row.deliverableId) ||
        d.fingerprintKey === fpKey
    );
    if (!deliverable) {
      deliverable = {
        projectId: row.projectId,
        deliverableId: row.deliverableId,
        deliverableName: row.deliverableName,
        fingerprintKey: fpKey,
        revisions: [],
      };
      project.deliverables.push(deliverable);
    }

    deliverable.revisions.push({
      snapshotId: row.snapshotId,
      snapshotVersion: row.snapshotVersion,
      snapshotRole: row.snapshotRole,
      programmeState: row.programmeState,
      projectId: row.projectId,
      deliverableId: row.deliverableId,
      deliverableName: row.deliverableName,
      importedAt: row.importedAt,
      durationDays: row.durationDays,
      fingerprintKey: fpKey,
    });
  }

  for (const project of byProject.values()) {
    for (const d of project.deliverables) {
      d.revisions.sort((a, b) => a.importedAt.getTime() - b.importedAt.getTime());
    }
  }

  return [...byProject.values()];
}

/**
 * Select the best revision per deliverable for benchmark statistics.
 * Prefers completed states, then latest import date.
 */
export function selectPrimaryRevisionPerDeliverable(
  revisions: HistoricalRevision[]
): HistoricalRevision | null {
  if (revisions.length === 0) return null;
  const sorted = [...revisions].sort((a, b) => {
    const p = revisionPriority(b.programmeState) - revisionPriority(a.programmeState);
    if (p !== 0) return p;
    return b.importedAt.getTime() - a.importedAt.getTime();
  });
  return sorted[0] ?? null;
}

/** Deduplicate benchmark samples: one primary observation per project+deliverable identity. */
export function deduplicateBenchmarkSamples<T extends HistoricalRevision & { durationDays: number }>(
  samples: T[]
): T[] {
  const byKey = new Map<string, T>();
  for (const sample of samples) {
    const key = `${sample.projectId}\x1d${sample.deliverableId ?? sample.fingerprintKey}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, sample);
      continue;
    }
    const pick =
      revisionPriority(sample.programmeState) > revisionPriority(existing.programmeState)
        ? sample
        : revisionPriority(sample.programmeState) === revisionPriority(existing.programmeState) &&
            sample.importedAt.getTime() > existing.importedAt.getTime()
          ? sample
          : existing;
    byKey.set(key, pick);
  }
  return [...byKey.values()];
}
