import { prisma } from "../../../utils/prisma.js";
import { getDeliverableBenchmark } from "../benchmark/benchmark.service.js";
import { generateRecommendations } from "../recommendations/recommendationEngine.service.js";
import { generateFindings } from "../findings/findings.service.js";
import { round1 } from "../shared/intelligenceMath.js";
import { resolveWorkPackageTaxonomy } from "../taxonomy/workPackageTaxonomy.service.js";

export type ProgrammeReviewItem = {
  deliverableId: string;
  deliverableName: string;
  workPackageKey: string;
  taxonomyKey: string | null;
  disciplineLabel: string | null;
  workPackageLabel: string | null;
  /** @deprecated Use workPackageLabel */
  engineeringActivityLabel: string | null;
  plannedDays: number | null;
  typicalDays: number | null;
  typicalRangeLabel: string | null;
  sampleSize: number;
  projectCount: number;
  outlierStatus: string | null;
  what: string;
  why: string;
  evidence: string;
  recommendation: string | null;
  needsReview: boolean;
};
export type ProgrammeReviewPresentation = {
  projectId: string;
  projectName: string;
  items: ProgrammeReviewItem[];
  reviewItems: ProgrammeReviewItem[];
  alignedItems: ProgrammeReviewItem[];
  noComparisonItems: ProgrammeReviewItem[];
};

function distinctProjectCount(projectIds: string[]): number {
  return new Set(projectIds.filter(Boolean)).size;
}

export async function buildProgrammeReviewPresentation(args: {
  projectId: string;
  companyId: string;
}): Promise<ProgrammeReviewPresentation> {
  const project = await prisma.project.findFirst({
    where: { id: args.projectId, companyId: args.companyId, archivedAt: null },
    select: { id: true, name: true },
  });
  if (!project) {
    const err: Error & { status?: number } = new Error("Project not found");
    err.status = 404;
    throw err;
  }

  const deliverables = await prisma.deliverable.findMany({
    where: { projectId: args.projectId, companyId: args.companyId },
    select: {
      id: true,
      name: true,
      fragnet: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
  const items: ProgrammeReviewItem[] = [];

  for (const del of deliverables) {
    try {
      const report = await getDeliverableBenchmark({
        projectId: args.projectId,
        companyId: args.companyId,
        deliverableId: del.id,
      });
      const findings = generateFindings(report);
      const recommendations = generateRecommendations(report, findings);
      const expected = report.benchmark.expectedDuration;
      const sampleSize = report.benchmark.sampleSize ?? 0;
      const matched = report.evidence?.matchedDeliverables ?? [];
      const otherProjectIds = matched
        .map((m) => m.projectId)
        .filter((pid) => pid && pid !== args.projectId);
      const projectCount = distinctProjectCount(otherProjectIds);
      const plannedDays = report.currentDurationDays ?? null;
      const typicalDays = expected?.mostLikelyDays ?? report.benchmark.medianDuration ?? null;
      const typicalRangeLabel = expected?.rangeLabel ?? null;
      const status = report.outlier?.status ?? null;

      const taxonomy = resolveWorkPackageTaxonomy({
        deliverableName: del.name,
        fragnetName: del.fragnet?.name ?? null,
      });
      const displayLabel =
        taxonomy.matched && taxonomy.workPackageLabel
          ? taxonomy.workPackageLabel
          : del.name.replace(/\s*—\s*Work package\s*$/i, "").trim();

      let what = displayLabel;
      let why = "";
      let evidence = "";
      let recommendation: string | null = recommendations[0]?.recommendation ?? null;
      let needsReview = false;

      if (sampleSize === 0) {
        what = displayLabel;
        why = "No similar work packages from other completed projects are available for comparison yet.";
        evidence = "0 comparable work packages from other projects";
      } else if (status === "NORMAL" || !status) {
        what = displayLabel;
        why = "Planned duration is in line with similar work on completed projects.";
        evidence = `${sampleSize} similar work package${sampleSize === 1 ? "" : "s"} from ${projectCount} other project${projectCount === 1 ? "" : "s"}`;
      } else if (status === "SLIGHTLY_HIGH" || status === "SLIGHTLY_LOW") {
        needsReview = true;
        what = displayLabel;
        const planned = plannedDays != null ? `${Math.round(plannedDays)} days planned` : "Current plan";
        const typical =
          typicalRangeLabel?.toLowerCase() ??
          (typicalDays != null ? `typical ${Math.round(typicalDays)} days` : "typical range");
        why = `${planned} — similar work on completed projects is usually ${typical}.`;
        evidence = `${sampleSize} similar work package${sampleSize === 1 ? "" : "s"} analysed`;
        recommendation = recommendation ?? "Review duration assumptions with the team.";
      } else {
        needsReview = true;
        what = displayLabel;
        const planned = plannedDays != null ? `Planned ${Math.round(plannedDays)} days` : "Current plan";
        const typical =
          typicalRangeLabel?.toLowerCase() ??
          (typicalDays != null ? `typical ${Math.round(typicalDays)} days` : "typical range");
        why = `${planned} — materially different from similar work on completed projects (usually ${typical}).`;
        evidence = `${sampleSize} similar work package${sampleSize === 1 ? "" : "s"} from ${projectCount} other project${projectCount === 1 ? "" : "s"}`;
        recommendation = recommendation ?? "Review duration assumptions and sequencing with the team.";
      }

      const workPackageKey =
        taxonomy.taxonomyKey ??
        del.name
          .replace(/\s*—\s*Work package\s*$/i, "")
          .trim()
          .toLowerCase();

      items.push({
        deliverableId: del.id,
        deliverableName: del.name,
        workPackageKey,
        taxonomyKey: taxonomy.taxonomyKey,
        disciplineLabel: taxonomy.disciplineLabel,
        workPackageLabel: taxonomy.workPackageLabel,
        engineeringActivityLabel: taxonomy.workPackageLabel,
        plannedDays: plannedDays != null ? round1(plannedDays) : null,
        typicalDays: typicalDays != null ? round1(typicalDays) : null,
        typicalRangeLabel,
        sampleSize,
        projectCount,
        outlierStatus: status,
        what,
        why,
        evidence,
        recommendation: needsReview ? recommendation : null,
        needsReview,
      });
    } catch {
      /* skip deliverables that fail benchmark */
    }
  }

  const reviewItems = items
    .filter((i) => i.needsReview)
    .sort((a, b) => (b.sampleSize - a.sampleSize) || a.deliverableName.localeCompare(b.deliverableName));
  const alignedItems = items.filter((i) => !i.needsReview && i.sampleSize > 0);
  const noComparisonItems = items.filter((i) => i.sampleSize === 0);

  return {
    projectId: project.id,
    projectName: project.name,
    items,
    reviewItems,
    alignedItems,
    noComparisonItems,
  };
}
