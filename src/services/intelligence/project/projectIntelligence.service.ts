/**
 * Project Intelligence — aggregation layer over existing Deliverable Intelligence.
 *
 * No new AI. No redesigned analytics. Rolls up programme review, evolution,
 * profile metadata, and similar projects into one deterministic object.
 */

import { prisma } from "../../../utils/prisma.js";
import {
  buildProgrammeReviewPresentation,
  type ProgrammeReviewItem,
  type ProgrammeReviewPresentation,
} from "../presentation/programmeReviewPresentation.service.js";
import {
  getDeliverableProjectEvolution,
  type DeliverableProjectEvolutionReport,
} from "../shared/deliverableProjectEvolution.service.js";
import { getSimilarProjects } from "../shared/similarity.service.js";
import {
  autoPopulateFromImportedProgrammeMetadata,
  getProfile,
} from "../profiles/intelligenceProfile.service.js";
import {
  buildPlannerRevisionStoryLabel,
  computeLiveUpdateIndices,
} from "../shared/programmeIdentity.service.js";

export type ProjectIntelligenceConfidence = "LOW" | "MEDIUM" | "HIGH" | "NONE";

export type ProjectIntelligenceFinding = {
  kind: string;
  deliverableId: string | null;
  deliverableName: string | null;
  disciplineLabel: string | null;
  statement: string;
  source: "programme_review" | "evolution" | "similarity" | "profile";
};

export type ProjectIntelligencePriority = {
  priority: number;
  deliverableId: string;
  deliverableName: string;
  reason: string;
  source: "programme_review" | "evolution";
};

export type ProjectIntelligenceDiscipline = {
  disciplineLabel: string;
  workPackageCount: number;
  withBenchmarkCoverage: number;
  withoutBenchmarkCoverage: number;
  needsReviewCount: number;
  planningConfidence: ProjectIntelligenceConfidence;
  notableRisks: string[];
  recommendations: string[];
};

export type ProjectIntelligence = {
  projectId: string;
  projectName: string;
  executiveSummary: {
    projectType: string | null;
    projectCategory: string | null;
    sector: string | null;
    stage: string | null;
    currentRevision: string | null;
    revisionCount: number;
    totalDeliverables: number;
    totalDisciplines: number;
    workPackagesAnalysed: number;
    comparableCompletedProjects: number;
    overallConfidence: ProjectIntelligenceConfidence;
    overallConfidenceNote: string;
  };
  programmeHealth: {
    findings: ProjectIntelligenceFinding[];
    summary: string;
  };
  planningQuality: {
    withinExpectedRange: number;
    aboveBenchmark: number;
    belowBenchmark: number;
    noComparison: number;
    alignmentNote: string;
  };
  projectEvolutionSummary: {
    revisionCount: number;
    workPackagesTracked: number;
    replanningEvents: number;
    workPackagesWithIncreasingRemaining: number;
    workPackagesWithRemainingProgress: number;
    largestPlanningChange: {
      deliverableId: string;
      deliverableName: string;
      absoluteDays: number;
      fromDays: number | null;
      toDays: number | null;
    } | null;
    largestProgrammeGrowth: {
      deliverableId: string;
      deliverableName: string;
      remainingIncreaseDays: number;
    } | null;
    summary: string;
  };
  disciplineOverview: ProjectIntelligenceDiscipline[];
  historicalContext: {
    similarProjects: Array<{
      projectId: string;
      projectName: string;
      similarityScore: number;
      confidenceLevel: string;
    }>;
    completedProjectsUsed: number;
    strongestEvidence: ProjectIntelligenceFinding[];
    weakestEvidence: ProjectIntelligenceFinding[];
    summary: string;
  };
  plannerPriorities: ProjectIntelligencePriority[];
  overallAssessment: string;
};

const ABOVE = new Set(["HIGH", "RED_FLAG", "EXTREME_OUTLIER", "SLIGHTLY_HIGH"]);
const BELOW = new Set(["WELL_BELOW", "SLIGHTLY_LOW"]);

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

function confidenceFromCoverage(args: {
  analysed: number;
  withComparison: number;
  reviewCount: number;
  similarProjectCount: number;
}): { level: ProjectIntelligenceConfidence; note: string } {
  const { analysed, withComparison, reviewCount, similarProjectCount } = args;
  if (analysed === 0) {
    return { level: "NONE", note: "No work packages available to analyse on this project." };
  }
  if (withComparison === 0) {
    return {
      level: "LOW",
      note: "Completed-project comparisons are not available yet for this programme.",
    };
  }
  const coverage = withComparison / analysed;
  if (coverage >= 0.6 && similarProjectCount >= 2 && reviewCount / analysed <= 0.25) {
    return {
      level: "HIGH",
      note: `Benchmark coverage on ${withComparison} of ${analysed} work packages, with ${similarProjectCount} similar completed projects.`,
    };
  }
  if (coverage >= 0.35 || similarProjectCount >= 1) {
    return {
      level: "MEDIUM",
      note: `Benchmark coverage on ${withComparison} of ${analysed} work packages.`,
    };
  }
  return {
    level: "LOW",
    note: "Limited historical evidence for this programme so far.",
  };
}

function disciplineConfidence(items: ProgrammeReviewItem[]): ProjectIntelligenceConfidence {
  if (items.length === 0) return "NONE";
  const withComparison = items.filter((i) => i.sampleSize > 0).length;
  if (withComparison === 0) return "LOW";
  const ratio = withComparison / items.length;
  const weak = items.filter((i) => i.sampleSize > 0 && i.sampleSize <= 2).length;
  if (ratio >= 0.7 && weak / items.length <= 0.3) return "HIGH";
  if (ratio >= 0.4) return "MEDIUM";
  return "LOW";
}

function outlierSeverityRank(status: string | null): number {
  if (!status) return 0;
  if (status === "EXTREME_OUTLIER" || status === "RED_FLAG") return 5;
  if (status === "HIGH" || status === "WELL_BELOW") return 4;
  if (status === "SLIGHTLY_HIGH" || status === "SLIGHTLY_LOW") return 2;
  return 0;
}

function resolveCurrentRevisionLabel(
  snapshots: Array<{
    snapshotRole: string | null;
    programmeState: string | null;
    label: string | null;
    snapshotVersion: number;
    importSummary: unknown;
  }>
): string | null {
  if (snapshots.length === 0) return null;
  const liveIndices = computeLiveUpdateIndices(
    snapshots.map((s) => ({
      snapshotRole: s.snapshotRole,
      programmeState: s.programmeState,
    }))
  );
  const last = snapshots[snapshots.length - 1]!;
  const lastIndex = snapshots.length - 1;
  const meta = liveIndices.get(lastIndex) ?? null;
  const summary = last.importSummary as Record<string, unknown> | undefined;
  const fromSummary = String(summary?.programmeDisplayName ?? "").trim();
  if (fromSummary) return fromSummary;
  return buildPlannerRevisionStoryLabel({
    snapshotRole: last.snapshotRole,
    programmeState: last.programmeState,
    liveUpdateIndex: meta?.index ?? null,
    isLatestLiveUpdate: meta?.isLatest ?? false,
    totalLiveUpdates: meta?.total ?? 0,
  });
}

function buildHealthFindings(
  review: ProgrammeReviewPresentation,
  evolutions: Array<{ item: ProgrammeReviewItem; report: DeliverableProjectEvolutionReport | null }>
): ProjectIntelligenceFinding[] {
  const findings: ProjectIntelligenceFinding[] = [];

  for (const item of review.reviewItems) {
    if (item.outlierStatus && ABOVE.has(item.outlierStatus)) {
      findings.push({
        kind: "unusually_long_planned",
        deliverableId: item.deliverableId,
        deliverableName: item.deliverableName,
        disciplineLabel: item.disciplineLabel,
        statement: item.why,
        source: "programme_review",
      });
    } else if (item.outlierStatus && BELOW.has(item.outlierStatus)) {
      findings.push({
        kind: "unusually_short_planned",
        deliverableId: item.deliverableId,
        deliverableName: item.deliverableName,
        disciplineLabel: item.disciplineLabel,
        statement: item.why,
        source: "programme_review",
      });
    } else if (item.needsReview) {
      findings.push({
        kind: "planning_assumption",
        deliverableId: item.deliverableId,
        deliverableName: item.deliverableName,
        disciplineLabel: item.disciplineLabel,
        statement: item.why,
        source: "programme_review",
      });
    }
  }

  for (const item of review.noComparisonItems.slice(0, 5)) {
    findings.push({
      kind: "missing_benchmark_coverage",
      deliverableId: item.deliverableId,
      deliverableName: item.deliverableName,
      disciplineLabel: item.disciplineLabel,
      statement: `${item.deliverableName}: no comparable completed projects for planned duration.`,
      source: "programme_review",
    });
  }

  for (const item of review.items) {
    if (item.sampleSize > 0 && item.sampleSize <= 2) {
      findings.push({
        kind: "weak_historical_evidence",
        deliverableId: item.deliverableId,
        deliverableName: item.deliverableName,
        disciplineLabel: item.disciplineLabel,
        statement: `${item.deliverableName}: only ${item.sampleSize} comparable work package${item.sampleSize === 1 ? "" : "s"} from completed projects.`,
        source: "programme_review",
      });
    }
  }

  for (const { item, report } of evolutions) {
    if (!report) continue;
    const latest = report.revisions[report.revisions.length - 1];
    if (!latest) continue;
    const remaining = latest.remainingDurationDays ?? latest.durationDays;
    const planning = latest.planningDurationDays;
    if (
      remaining != null &&
      planning != null &&
      planning > 0 &&
      remaining > planning * 1.5 &&
      remaining - planning >= 5
    ) {
      findings.push({
        kind: "unusually_large_remaining_work",
        deliverableId: item.deliverableId,
        deliverableName: item.deliverableName,
        disciplineLabel: item.disciplineLabel,
        statement: `${item.deliverableName}: remaining work (${remaining} days) is substantially above planned duration (${planning} days).`,
        source: "evolution",
      });
    }
  }

  // Deduplicate by kind+deliverableId
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.kind}:${f.deliverableId ?? f.statement}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildDisciplineOverview(items: ProgrammeReviewItem[]): ProjectIntelligenceDiscipline[] {
  const byDiscipline = new Map<string, ProgrammeReviewItem[]>();
  for (const item of items) {
    const label = item.disciplineLabel?.trim() || "Unclassified";
    const list = byDiscipline.get(label) ?? [];
    list.push(item);
    byDiscipline.set(label, list);
  }

  return [...byDiscipline.entries()]
    .map(([disciplineLabel, group]) => {
      const withCoverage = group.filter((i) => i.sampleSize > 0).length;
      const without = group.length - withCoverage;
      const needsReview = group.filter((i) => i.needsReview);
      const notableRisks = needsReview.slice(0, 3).map((i) => i.why);
      const recommendations = needsReview
        .map((i) => i.recommendation)
        .filter((r): r is string => Boolean(r))
        .slice(0, 3);
      return {
        disciplineLabel,
        workPackageCount: group.length,
        withBenchmarkCoverage: withCoverage,
        withoutBenchmarkCoverage: without,
        needsReviewCount: needsReview.length,
        planningConfidence: disciplineConfidence(group),
        notableRisks,
        recommendations,
      };
    })
    .sort((a, b) => b.needsReviewCount - a.needsReviewCount || b.workPackageCount - a.workPackageCount);
}

function buildPlannerPriorities(
  review: ProgrammeReviewPresentation,
  evolutions: Array<{ item: ProgrammeReviewItem; report: DeliverableProjectEvolutionReport | null }>
): ProjectIntelligencePriority[] {
  type Candidate = ProjectIntelligencePriority & { score: number };
  const candidates: Candidate[] = [];

  for (const item of review.reviewItems) {
    const severity = outlierSeverityRank(item.outlierStatus);
    candidates.push({
      priority: 0,
      deliverableId: item.deliverableId,
      deliverableName: item.workPackageLabel ?? item.deliverableName,
      reason: item.why,
      source: "programme_review",
      score: 100 + severity * 20 + Math.min(item.sampleSize, 10),
    });
  }

  for (const item of review.items) {
    if (item.sampleSize === 1 && !item.needsReview) {
      candidates.push({
        priority: 0,
        deliverableId: item.deliverableId,
        deliverableName: item.workPackageLabel ?? item.deliverableName,
        reason: "Only one comparable completed project.",
        source: "programme_review",
        score: 40,
      });
    }
  }

  for (const { item, report } of evolutions) {
    if (!report || report.revisions.length < 2) continue;
    let maxRemainingIncrease = 0;
    for (const rev of report.revisions) {
      if (rev.changeKind === "remaining_increase") {
        const delta = rev.remainingDurationChangeDays ?? rev.durationChangeDays ?? 0;
        if (delta > maxRemainingIncrease) maxRemainingIncrease = delta;
      }
    }
    if (maxRemainingIncrease > 0) {
      candidates.push({
        priority: 0,
        deliverableId: item.deliverableId,
        deliverableName: item.workPackageLabel ?? item.deliverableName,
        reason: `Largest remaining-work increase of +${maxRemainingIncrease} days across programme updates.`,
        source: "evolution",
        score: 50 + maxRemainingIncrease,
      });
    }
  }

  // Keep best candidate per deliverable
  const bestById = new Map<string, Candidate>();
  for (const c of candidates) {
    const prev = bestById.get(c.deliverableId);
    if (!prev || c.score > prev.score) bestById.set(c.deliverableId, c);
  }

  return [...bestById.values()]
    .sort((a, b) => b.score - a.score || a.deliverableName.localeCompare(b.deliverableName))
    .slice(0, 8)
    .map((c, index) => ({
      priority: index + 1,
      deliverableId: c.deliverableId,
      deliverableName: c.deliverableName,
      reason: c.reason,
      source: c.source,
    }));
}

function buildOverallAssessment(args: {
  projectCategory: string | null;
  projectType: string | null;
  sector: string | null;
  planningQuality: ProjectIntelligence["planningQuality"];
  priorities: ProjectIntelligencePriority[];
  comparableCompletedProjects: number;
  confidence: ProjectIntelligenceConfidence;
}): string {
  const {
    projectCategory,
    projectType,
    sector,
    planningQuality,
    priorities,
    comparableCompletedProjects,
    confidence,
  } = args;

  const peerLabel =
    projectCategory ??
    projectType ??
    sector ??
    "previous completed projects";

  const totalCompared =
    planningQuality.withinExpectedRange +
    planningQuality.aboveBenchmark +
    planningQuality.belowBenchmark;

  const parts: string[] = [];

  if (comparableCompletedProjects === 0 || totalCompared === 0) {
    parts.push(
      "Overall this programme does not yet have enough completed-project history for a firm health judgement."
    );
  } else if (
    planningQuality.withinExpectedRange >=
    planningQuality.aboveBenchmark + planningQuality.belowBenchmark
  ) {
    parts.push(`Overall this programme aligns well with previous ${peerLabel.toLowerCase()} projects.`);
    parts.push("Most work packages fall within historical planning ranges.");
  } else if (planningQuality.aboveBenchmark + planningQuality.belowBenchmark > 0) {
    parts.push(
      `Overall this programme shows mixed alignment with previous ${peerLabel.toLowerCase()} projects.`
    );
    parts.push(
      `${planningQuality.withinExpectedRange} work package${planningQuality.withinExpectedRange === 1 ? "" : "s"} within expected range, ${planningQuality.aboveBenchmark} above benchmark, ${planningQuality.belowBenchmark} below.`
    );
  }

  if (priorities.length > 0) {
    const top = priorities.slice(0, 3).map((p) => p.deliverableName);
    const named =
      top.length === 1
        ? top[0]
        : top.length === 2
          ? `${top[0]} and ${top[1]}`
          : `${top.slice(0, -1).join(", ")}, and ${top[top.length - 1]}`;
    const evolutionLed = priorities.slice(0, 3).every((p) => p.source === "evolution");
    if (comparableCompletedProjects === 0 || totalCompared === 0) {
      parts.push(
        evolutionLed
          ? `Primary watch areas from programme updates are ${named}.`
          : `Primary review areas are ${named}.`
      );
    } else {
      parts.push(
        `The primary review areas are ${named} because they exceed historical planning assumptions or have limited evidence.`
      );
    }
  } else if (confidence === "HIGH" || confidence === "MEDIUM") {
    parts.push("No major review priorities stand out from current analytics.");
  }

  return parts.filter(Boolean).join(" ");
}

/** Serialise a compact fact list for Ask Rana confirmedFacts (no prompt redesign). */
export function projectIntelligenceToAskRanaFacts(pi: ProjectIntelligence): string[] {
  const facts: string[] = [];
  const e = pi.executiveSummary;
  facts.push(`Project Intelligence — ${pi.projectName}`);
  if (e.projectCategory || e.projectType) {
    facts.push(
      `Project category/type: ${[e.projectCategory, e.projectType].filter(Boolean).join(" / ")}`
    );
  }
  if (e.currentRevision) facts.push(`Current revision: ${e.currentRevision}`);
  facts.push(
    `${e.totalDeliverables} deliverables · ${e.totalDisciplines} disciplines · ${e.workPackagesAnalysed} work packages analysed`
  );
  facts.push(
    `Comparable completed projects: ${e.comparableCompletedProjects} · Overall confidence: ${e.overallConfidence}`
  );
  facts.push(`Planning quality: ${pi.planningQuality.alignmentNote}`);
  if (pi.projectEvolutionSummary.summary) facts.push(pi.projectEvolutionSummary.summary);
  for (const p of pi.plannerPriorities.slice(0, 5)) {
    facts.push(`Priority ${p.priority}: Review ${p.deliverableName} — ${p.reason}`);
  }
  if (pi.overallAssessment) facts.push(pi.overallAssessment);
  return facts;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: ProjectIntelligence }>();

/**
 * Build Project Intelligence for a programme.
 * Aggregates existing services only. Short-lived cache avoids duplicate work
 * when UI and Ask Rana request the same programme in the same minute.
 */
export async function getProjectIntelligence(args: {
  projectId: string;
  companyId: string;
}): Promise<ProjectIntelligence> {
  const cacheKey = `${args.companyId}:${args.projectId}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  await autoPopulateFromImportedProgrammeMetadata(args.projectId, args.companyId);

  const [review, profile, similar, snapshots] = await Promise.all([
    buildProgrammeReviewPresentation(args),
    getProfile(args.projectId, args.companyId),
    getSimilarProjects({ ...args, limit: 8 }).catch(() => null),
    prisma.programmeSnapshot.findMany({
      where: { projectId: args.projectId, companyId: args.companyId },
      orderBy: [{ importedAt: "asc" }, { snapshotVersion: "asc" }],
      select: {
        snapshotRole: true,
        programmeState: true,
        label: true,
        snapshotVersion: true,
        importSummary: true,
      },
    }),
  ]);

  const evolutions = await mapPool(review.items, 4, async (item) => {
    try {
      const report = await getDeliverableProjectEvolution({
        projectId: args.projectId,
        companyId: args.companyId,
        deliverableId: item.deliverableId,
      });
      return { item, report };
    } catch {
      return { item, report: null as DeliverableProjectEvolutionReport | null };
    }
  });

  const disciplineOverview = buildDisciplineOverview(review.items);
  const disciplines = new Set(
    review.items.map((i) => i.disciplineLabel?.trim() || "Unclassified").filter(Boolean)
  );

  const comparableCompletedProjects = Math.max(
    similar?.matches.filter((m) => m.similarityScore > 0).length ?? 0,
    ...review.items.map((i) => i.projectCount),
    0
  );

  const withComparison = review.items.filter((i) => i.sampleSize > 0).length;
  const confidence = confidenceFromCoverage({
    analysed: review.items.length,
    withComparison,
    reviewCount: review.reviewItems.length,
    similarProjectCount: similar?.matches.filter((m) => m.similarityScore > 0).length ?? 0,
  });

  const aboveBenchmark = review.items.filter(
    (i) => i.outlierStatus && ABOVE.has(i.outlierStatus)
  ).length;
  const belowBenchmark = review.items.filter(
    (i) => i.outlierStatus && BELOW.has(i.outlierStatus)
  ).length;
  const withinExpectedRange = review.alignedItems.length;
  const noComparison = review.noComparisonItems.length;

  let alignmentNote: string;
  if (review.items.length === 0) {
    alignmentNote = "No work packages to compare.";
  } else if (withComparison === 0) {
    alignmentNote = "No completed-project benchmarks available yet.";
  } else {
    alignmentNote = `${withinExpectedRange} within expected range, ${aboveBenchmark} above benchmark, ${belowBenchmark} below benchmark, ${noComparison} without comparison.`;
  }

  // Evolution aggregates
  let replanningEvents = 0;
  let remainingIncreaseWps = 0;
  let remainingProgressWps = 0;
  let largestPlanningChange: ProjectIntelligence["projectEvolutionSummary"]["largestPlanningChange"] =
    null;
  let largestProgrammeGrowth: ProjectIntelligence["projectEvolutionSummary"]["largestProgrammeGrowth"] =
    null;
  let tracked = 0;

  for (const { item, report } of evolutions) {
    if (!report || report.revisions.length < 2) continue;
    tracked += 1;
    let wpHadIncrease = false;
    let wpHadProgress = false;
    for (let i = 1; i < report.revisions.length; i++) {
      const rev = report.revisions[i]!;
      if (rev.changeKind === "replanning") {
        replanningEvents += 1;
        const abs = Math.abs(rev.planningDurationChangeDays ?? 0);
        if (abs > 0) {
          const planning = rev.planningDurationDays;
          const prev =
            planning != null && rev.planningDurationChangeDays != null
              ? planning - rev.planningDurationChangeDays
              : null;
          if (!largestPlanningChange || abs > largestPlanningChange.absoluteDays) {
            largestPlanningChange = {
              deliverableId: item.deliverableId,
              deliverableName: item.workPackageLabel ?? item.deliverableName,
              absoluteDays: abs,
              fromDays: prev,
              toDays: planning,
            };
          }
        }
      }
      if (rev.changeKind === "remaining_increase") {
        wpHadIncrease = true;
        const delta = rev.remainingDurationChangeDays ?? rev.durationChangeDays ?? 0;
        if (delta > 0 && (!largestProgrammeGrowth || delta > largestProgrammeGrowth.remainingIncreaseDays)) {
          largestProgrammeGrowth = {
            deliverableId: item.deliverableId,
            deliverableName: item.workPackageLabel ?? item.deliverableName,
            remainingIncreaseDays: delta,
          };
        }
      }
      if (rev.changeKind === "progress") wpHadProgress = true;
    }
    if (wpHadIncrease) remainingIncreaseWps += 1;
    if (wpHadProgress) remainingProgressWps += 1;
  }

  const evoParts: string[] = [];
  if (snapshots.length <= 1) {
    evoParts.push("Only the Baseline (or a single revision) is imported — limited evolution signal.");
  } else {
    evoParts.push(
      `${snapshots.length} programme revisions · ${tracked} work packages with multi-revision history.`
    );
    evoParts.push(
      `${replanningEvents} replanning event${replanningEvents === 1 ? "" : "s"} · ${remainingIncreaseWps} work package${remainingIncreaseWps === 1 ? "" : "s"} with increasing remaining work.`
    );
    if (largestPlanningChange) {
      evoParts.push(
        `Largest planning change: ${largestPlanningChange.deliverableName} (${largestPlanningChange.absoluteDays} days).`
      );
    }
    if (largestProgrammeGrowth) {
      evoParts.push(
        `Largest remaining-work growth: ${largestProgrammeGrowth.deliverableName} (+${largestProgrammeGrowth.remainingIncreaseDays} days).`
      );
    }
  }

  const healthFindings = buildHealthFindings(review, evolutions);
  const healthSummaryParts: string[] = [];
  const longCount = healthFindings.filter((f) => f.kind === "unusually_long_planned").length;
  const missingCount = healthFindings.filter((f) => f.kind === "missing_benchmark_coverage").length;
  const weakCount = healthFindings.filter((f) => f.kind === "weak_historical_evidence").length;
  if (longCount > 0) healthSummaryParts.push(`${longCount} unusually long planned work package${longCount === 1 ? "" : "s"}`);
  if (missingCount > 0) healthSummaryParts.push(`${missingCount} without benchmark coverage`);
  if (weakCount > 0) healthSummaryParts.push(`${weakCount} with weak historical evidence`);
  const programmeHealthSummary =
    healthSummaryParts.length > 0
      ? `Programme health signals: ${healthSummaryParts.join("; ")}.`
      : withComparison > 0
        ? "No major programme health concerns from current benchmark and evolution signals."
        : "Programme health cannot be judged until completed projects are available for comparison.";

  const strongestEvidence = review.items
    .filter((i) => i.sampleSize >= 5)
    .sort((a, b) => b.sampleSize - a.sampleSize)
    .slice(0, 3)
    .map(
      (i): ProjectIntelligenceFinding => ({
        kind: "strong_evidence",
        deliverableId: i.deliverableId,
        deliverableName: i.deliverableName,
        disciplineLabel: i.disciplineLabel,
        statement: `${i.deliverableName}: ${i.sampleSize} comparable work packages from ${i.projectCount} completed projects.`,
        source: "programme_review",
      })
    );

  const weakestEvidence = review.items
    .filter((i) => i.sampleSize > 0 && i.sampleSize <= 2)
    .sort((a, b) => a.sampleSize - b.sampleSize)
    .slice(0, 3)
    .map(
      (i): ProjectIntelligenceFinding => ({
        kind: "weak_evidence",
        deliverableId: i.deliverableId,
        deliverableName: i.deliverableName,
        disciplineLabel: i.disciplineLabel,
        statement: `${i.deliverableName}: only ${i.sampleSize} comparable work package${i.sampleSize === 1 ? "" : "s"}.`,
        source: "programme_review",
      })
    );

  const similarMatches = (similar?.matches ?? [])
    .filter((m) => m.similarityScore > 0)
    .slice(0, 5)
    .map((m) => ({
      projectId: m.projectId,
      projectName: m.projectName,
      similarityScore: m.similarityScore,
      confidenceLevel: m.confidenceLevel,
    }));

  const historicalSummary =
    similarMatches.length > 0
      ? `Strongest similar projects: ${similarMatches
          .slice(0, 3)
          .map((m) => m.projectName)
          .join(", ")}.`
      : "No similar completed projects identified yet.";

  const priorities = buildPlannerPriorities(review, evolutions);
  const projectCategory = profile.sector ?? profile.projectType ?? null;
  const projectType = profile.projectType ?? null;

  const overallAssessment = buildOverallAssessment({
    projectCategory,
    projectType,
    sector: profile.sector,
    planningQuality: {
      withinExpectedRange,
      aboveBenchmark,
      belowBenchmark,
      noComparison,
      alignmentNote,
    },
    priorities,
    comparableCompletedProjects,
    confidence: confidence.level,
  });

  // Discipline-outside-norms: disciplines where majority of WPs need review
  const disciplineFindings: ProjectIntelligenceFinding[] = disciplineOverview
    .filter((d) => d.workPackageCount >= 2 && d.needsReviewCount / d.workPackageCount >= 0.5)
    .map((d) => ({
      kind: "discipline_outside_norms",
      deliverableId: null,
      deliverableName: null,
      disciplineLabel: d.disciplineLabel,
      statement: `${d.disciplineLabel}: ${d.needsReviewCount} of ${d.workPackageCount} work packages need review against historical norms.`,
      source: "programme_review" as const,
    }));

  const result: ProjectIntelligence = {
    projectId: review.projectId,
    projectName: review.projectName,
    executiveSummary: {
      projectType,
      projectCategory,
      sector: profile.sector,
      stage: profile.stage ?? profile.primaryRibaStage,
      currentRevision: resolveCurrentRevisionLabel(snapshots),
      revisionCount: snapshots.length,
      totalDeliverables: review.items.length,
      totalDisciplines: disciplines.size,
      workPackagesAnalysed: review.items.length,
      comparableCompletedProjects,
      overallConfidence: confidence.level,
      overallConfidenceNote: confidence.note,
    },
    programmeHealth: {
      findings: [...disciplineFindings, ...healthFindings].slice(0, 24),
      summary: programmeHealthSummary,
    },
    planningQuality: {
      withinExpectedRange,
      aboveBenchmark,
      belowBenchmark,
      noComparison,
      alignmentNote,
    },
    projectEvolutionSummary: {
      revisionCount: snapshots.length,
      workPackagesTracked: tracked,
      replanningEvents,
      workPackagesWithIncreasingRemaining: remainingIncreaseWps,
      workPackagesWithRemainingProgress: remainingProgressWps,
      largestPlanningChange,
      largestProgrammeGrowth,
      summary: evoParts.join(" "),
    },
    disciplineOverview,
    historicalContext: {
      similarProjects: similarMatches,
      completedProjectsUsed: comparableCompletedProjects,
      strongestEvidence,
      weakestEvidence,
      summary: historicalSummary,
    },
    plannerPriorities: priorities,
    overallAssessment,
  };

  cache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}
