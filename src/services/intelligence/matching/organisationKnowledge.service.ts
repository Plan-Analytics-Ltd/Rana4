import { prisma } from "../../../utils/prisma.js";
import { ALLOWED_SNAPSHOT_STATES } from "../shared/intelligenceConstants.js";
import { diffDaysFromDates } from "../shared/intelligenceMath.js";
import { buildDeliverableFingerprint } from "./deliverableFingerprint.service.js";
import { computeDeliverableEvolution } from "./deliverableEvolution.service.js";
import { detectOrganisationalPatterns } from "./historicalAnomalyDetection.service.js";
import { groupHistoricalRevisions } from "./revisionGrouping.service.js";

export type OrganisationKnowledgeEntry = {
  id: string;
  category: string;
  label: string;
  summary: string;
  metric?: number | null;
  deliverableName?: string | null;
  classification?: string | null;
};

export type OrganisationKnowledgeReport = {
  entries: OrganisationKnowledgeEntry[];
  patterns: ReturnType<typeof detectOrganisationalPatterns>;
  projectCount: number;
  deliverableCount: number;
  revisionCount: number;
};

/** Build organisation-level intelligence from historical programme snapshots. */
export async function buildOrganisationKnowledge(companyId: string): Promise<OrganisationKnowledgeReport> {
  const snapshots = await prisma.programmeSnapshot.findMany({
    where: {
      companyId,
      programmeState: { in: ALLOWED_SNAPSHOT_STATES },
      project: { archivedAt: null },
    },
    include: {
      deliverableSnapshots: true,
      project: { select: { id: true, name: true } },
    },
    orderBy: { importedAt: "asc" },
    take: 500,
  });

  const evolutionRecords: Array<{
    deliverableName: string;
    classification: string | null;
    projectId: string;
    evolution: ReturnType<typeof computeDeliverableEvolution>;
  }> = [];

  const revisionRows: Array<Parameters<typeof groupHistoricalRevisions>[0][number]> = [];

  for (const snap of snapshots) {
    for (const d of snap.deliverableSnapshots) {
      const durationActual = diffDaysFromDates(d.actualStart, d.actualFinish);
      const durationPlanned = diffDaysFromDates(d.plannedStart, d.plannedFinish);
      const durationDays = durationActual ?? durationPlanned;

      const fp = buildDeliverableFingerprint({
        deliverableName: d.name,
        classification: d.classification,
        programmeState: snap.programmeState,
        stage: snap.stage,
      });

      revisionRows.push({
        snapshotId: snap.id,
        snapshotVersion: snap.snapshotVersion,
        snapshotRole: snap.snapshotRole,
        programmeState: snap.programmeState,
        projectId: snap.projectId,
        projectName: snap.project.name,
        deliverableId: d.deliverableId,
        deliverableName: d.name,
        importedAt: snap.importedAt,
        durationDays,
        fingerprint: fp,
      });
    }
  }

  const projects = groupHistoricalRevisions(revisionRows);
  const entries: OrganisationKnowledgeEntry[] = [];

  for (const project of projects) {
    for (const del of project.deliverables) {
      const evolution = computeDeliverableEvolution(del.revisions);
      evolutionRecords.push({
        deliverableName: del.deliverableName,
        classification: null,
        projectId: del.projectId,
        evolution,
      });

      if (evolution.trend === "STABLE" && evolution.revisionCount >= 2) {
        entries.push({
          id: `stable-${del.projectId}-${del.deliverableName}`.replace(/\s+/g, "-").toLowerCase(),
          category: "stable_deliverables",
          label: del.deliverableName,
          summary: `${del.deliverableName} remained relatively stable across ${evolution.revisionCount} programme revisions.`,
          metric: evolution.finalDuration,
          deliverableName: del.deliverableName,
        });
      }
      if (evolution.trend === "GROWING" && (evolution.growthPercent ?? 0) >= 20) {
        entries.push({
          id: `volatile-${del.deliverableName}`,
          category: "volatile_deliverables",
          label: del.deliverableName,
          summary: `${del.deliverableName} showed repeated duration growth across revisions (up to ${evolution.growthPercent}% from baseline).`,
          metric: evolution.growthPercent,
          deliverableName: del.deliverableName,
        });
      }
      if (evolution.trend === "SHRINKING") {
        entries.push({
          id: `reduced-${del.deliverableName}`,
          category: "frequently_reduced",
          label: del.deliverableName,
          summary: `${del.deliverableName} was frequently reduced before completion in historical programmes.`,
          metric: evolution.reductionPercent,
          deliverableName: del.deliverableName,
        });
      }
    }
  }

  const patterns = detectOrganisationalPatterns(evolutionRecords);

  const projectCount = projects.length;
  const deliverableCount = new Set(evolutionRecords.map((e) => e.deliverableName.toLowerCase())).size;
  const revisionCount = revisionRows.length;

  return {
    entries: entries.slice(0, 50),
    patterns,
    projectCount,
    deliverableCount,
    revisionCount,
  };
}
