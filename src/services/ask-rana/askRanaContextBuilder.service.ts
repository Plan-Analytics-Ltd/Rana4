import { getDeliverableIntelligenceAnalysis } from "../intelligence/orchestration/intelligenceOrchestrator.service.js";
import { getDeliverableProjectEvolution } from "../intelligence/shared/deliverableProjectEvolution.service.js";
import { getSimilarProjects } from "../intelligence/shared/similarity.service.js";
import { listLessonsLearned } from "../intelligence/learning/lessonsLearned.service.js";
import { formatClassificationLabel } from "../intelligence/shared/durationEvidence.service.js";
import { trustBandLabel } from "../intelligence/trust/intelligenceTrust.service.js";
import { resolveEvidenceDomains } from "./askRanaEvidenceScopeResolver.service.js";
import { interpretPlannerQuery } from "./askRanaPlannerQueryInterpreter.service.js";
import type { PlannerQuery } from "./askRanaPlannerQuery.types.js";
import type {
  AskRanaEvidenceDomain,
  AskRanaEvidencePackage,
  AskRanaRequest,
} from "./askRana.types.js";

function humanRole(role: string | null): string {
  if (role === "BASELINE") return "Baseline";
  if (role === "AS_BUILT") return "As-built";
  if (role === "LIVE_IMPORT") return "Programme update";
  return role?.replace(/_/g, " ") ?? "Update";
}

function humanTrend(trend: string | null): string | null {
  switch (trend) {
    case "GROWING":
      return "Duration trended upward";
    case "SHRINKING":
      return "Duration trended downward";
    case "STABLE":
      return "Duration remained broadly stable";
    case "OSCILLATING":
      return "Duration moved up and down";
    default:
      return null;
  }
}

function similarityPhrase(score: number): string {
  if (score >= 75) return "Very similar";
  if (score >= 55) return "Quite similar";
  if (score >= 35) return "Somewhat similar";
  if (score > 0) return "Loosely similar";
  return "Limited similarity";
}

function comparisonAssessment(outlierStatus: string | null, positionLabel: string | null): string | null {
  if (positionLabel) {
    return positionLabel
      .replace(/historical benchmark/gi, "completed projects")
      .replace(/benchmark/gi, "completed projects");
  }
  switch (outlierStatus) {
    case "NORMAL":
      return "Looks normal compared with similar work on completed projects";
    case "SLIGHTLY_HIGH":
    case "SLIGHTLY_LOW":
      return "Worth a review — a bit different to what usually happens";
    case "HIGH":
    case "RED_FLAG":
    case "EXTREME_OUTLIER":
    case "WELL_BELOW":
      return "Materially different to what usually happens on similar projects";
    default:
      return null;
  }
}

/**
 * Collects deterministic evidence for Ask Rana.
 * All facts originate from existing intelligence services — no new calculations.
 */
export async function buildAskRanaEvidencePackage(
  request: AskRanaRequest,
  plannerQuery: PlannerQuery
): Promise<AskRanaEvidencePackage> {
  const domains = resolveEvidenceDomains(plannerQuery, request.question);
  const evidenceGaps: string[] = [];
  const deliverableId = request.deliverableId?.trim() || null;
  const projectScope = !deliverableId;

  const needsAnalysis =
    !projectScope &&
    (domains.includes("previousProjects") ||
      domains.includes("recommendations") ||
      domains.includes("observations") ||
      domains.includes("keyFactors") ||
      domains.includes("trust"));

  const needsEvolution =
    !projectScope && (domains.includes("projectEvolution") || domains.includes("programmeLogic"));
  const needsLessons = domains.includes("lessonsLearned");
  const needsSimilar = domains.includes("similarProjects") || projectScope;

  const [analysis, evolution, lessons, similarProjects] = await Promise.all([
    needsAnalysis
      ? getDeliverableIntelligenceAnalysis({
          projectId: request.projectId,
          companyId: request.companyId,
          deliverableId: deliverableId!,
          selectedProjectIds: request.selectedProjectIds,
        }).catch(() => null)
      : Promise.resolve(null),
    needsEvolution
      ? getDeliverableProjectEvolution({
          projectId: request.projectId,
          companyId: request.companyId,
          deliverableId: deliverableId!,
        }).catch(() => null)
      : Promise.resolve(null),
    needsLessons ? listLessonsLearned(request.companyId).catch(() => []) : Promise.resolve([]),
    needsSimilar
      ? getSimilarProjects({
          projectId: request.projectId,
          companyId: request.companyId,
          limit: 8,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const deliverableName = projectScope
    ? "This programme"
    : analysis?.deliverable.name ?? evolution?.deliverableName ?? "This deliverable";
  const classification = analysis?.deliverable.classification
    ? formatClassificationLabel(String(analysis.deliverable.classification))
    : null;
  const currentDurationDays =
    analysis?.durationView?.current.durationDays ??
    analysis?.currentDurationDays ??
    evolution?.durationView?.current.durationDays ??
    evolution?.projectEvolutionIntelligence?.latest ??
    evolution?.evolution.finalDuration ??
    null;

  const pkg: AskRanaEvidencePackage = {
    deliverable: {
      name: deliverableName,
      classification,
      currentDurationDays,
    },
    plannerQuery,
    previousProjects: null,
    projectEvolution: null,
    programmeLogic: null,
    recommendations: null,
    observations: null,
    keyFactors: null,
    trust: null,
    lessonsLearned: null,
    similarProjects: null,
    sources: domains,
    evidenceGaps,
  };

  if (domains.includes("previousProjects")) {
    if (projectScope) {
      evidenceGaps.push(
        "Open a deliverable to compare its duration against completed projects, or ask about similar projects at programme level."
      );
    } else if (analysis) {
      const sampleSize = analysis.benchmark?.sampleSize ?? analysis.evidence?.sampleSize ?? 0;
      const matched = analysis.evidence?.matchedDeliverables ?? [];
      const otherProjects = new Set(
        matched.filter((m) => m.projectId && m.projectId !== request.projectId).map((m) => m.projectId)
      );
      const expected = analysis.benchmark?.expectedDuration ?? null;
      const typical =
        expected?.mostLikelyDays ?? analysis.benchmark?.medianDuration ?? null;

      pkg.previousProjects = {
        available: sampleSize > 0 && otherProjects.size > 0,
        currentDurationDays: analysis.currentDurationDays,
        comparisonAssessment: comparisonAssessment(
          analysis.outlier?.status ?? null,
          analysis.outlier?.effectivePositionLabel ?? analysis.outlier?.positionLabel ?? null
        ),
        typicalRangeLabel: expected?.rangeLabel ?? null,
        typicalDurationDays: typical != null && Number.isFinite(typical) ? Math.round(typical) : null,
        sampleSize,
        completedProjectCount: otherProjects.size,
        comparableWork: matched
          .filter((m) => m.projectId !== request.projectId)
          .slice(0, 8)
          .map((m) => ({
            deliverableName: m.deliverableName ?? "Similar deliverable",
            projectName: m.projectName ?? "Completed project",
            durationDays: m.durationDays ?? null,
            programmeState: m.programmeState ?? null,
          })),
        observations: analysis.observations?.slice(0, 4).map((o) => `${o.title}: ${o.summary}`) ?? [],
      };

      if (!pkg.previousProjects.available) {
        evidenceGaps.push(
          "Completed-project comparison is not available yet — answer from this project's revision history first."
        );
      }
    } else {
      evidenceGaps.push("Previous project comparison data could not be loaded.");
    }
  }

  if (domains.includes("projectEvolution")) {
    if (projectScope) {
      evidenceGaps.push("Open a deliverable to ask about its revision history on this project.");
    } else if (evolution && evolution.revisions.length > 0) {
      const intel = evolution.projectEvolutionIntelligence;
      const q = request.question.toLowerCase();
      const showFullTimeline = /\b(revision history|show timeline|show me the timeline|timeline)\b/.test(q);
      pkg.projectEvolution = {
        available: true,
        revisionCount: evolution.revisions.length,
        summary: intel.summary,
        baselineDays: intel.baseline,
        latestDays: intel.latest,
        netChangeDays: intel.netChange,
        trend: humanTrend(intel.trend),
        changePattern: intel.changePattern,
        volatility: intel.volatility,
        howChangedSummary: intel.howChangedSummary,
        timelineHighlights: intel.timelineHighlights,
        plannerObservations: intel.plannerObservations,
        revisionHighlights: intel.revisionHighlights.map((h) => ({
          label: h.revisionLabel,
          role: evolution.revisions[h.revisionIndex]?.role ?? h.role,
          durationDays: h.durationDays,
          changeDays: h.durationChangeDays,
          reason: h.highlightReason,
        })),
        stablePeriods: intel.stablePeriods.map((p) => ({
          startLabel: p.startLabel,
          endLabel: p.endLabel,
          durationDays: p.durationDays,
          revisionCount: p.revisionCount,
        })),
        revisions: evolution.revisions.map((r) => ({
          label: r.label,
          role: humanRole(r.role),
          importedAt: r.importedAt,
          durationDays: r.durationDays,
          durationChangeDays: r.durationChangeDays,
        })),
        showFullTimeline,
      };
    } else {
      evidenceGaps.push("No revision history on this project yet.");
    }
  }

  if (domains.includes("programmeLogic")) {
    if (projectScope) {
      evidenceGaps.push("Open a deliverable to ask about programme logic, float, or relationships.");
    } else if (evolution?.programmeLogicEvolution?.length) {
      const hasEvents = evolution.programmeLogicEvolution.some((r) => r.events.length > 0);
      pkg.programmeLogic = {
        available: hasEvents || evolution.programmeLogicSummary != null,
        summary: evolution.programmeLogicSummary,
        revisions: evolution.programmeLogicEvolution.map((r) => ({
          label: r.revisionLabel,
          relationshipCount: r.relationshipCount,
          relationshipCountChange: r.relationshipCountChange,
          events: r.events.slice(0, 12).map((e) => ({
            type: e.type,
            activityCode: e.activityCode,
            description: e.description,
            predecessorCode: e.predecessorCode,
            lagDays: e.lagDays,
          })),
          plannerObservations: r.plannerObservations.slice(0, 8),
        })),
      };
    } else {
      evidenceGaps.push("No programme logic revision history available for this deliverable.");
    }
  }

  if (domains.includes("recommendations") && analysis) {
    const recs = analysis.recommendations ?? [];
    pkg.recommendations = {
      available: recs.length > 0,
      items: recs.slice(0, 6).map((r) => ({
        title: r.title,
        summary: r.summary,
        recommendation: r.recommendation,
        severity: r.severity,
      })),
    };
    if (!pkg.recommendations.available) {
      evidenceGaps.push("No recommendations have been generated for this deliverable yet.");
    }
  }

  if (domains.includes("observations") && analysis) {
    pkg.observations =
      analysis.observations?.slice(0, 6).map((o) => `${o.title}: ${o.summary}`) ?? [];
  }

  if (domains.includes("keyFactors") && analysis) {
    pkg.keyFactors = analysis.keyFactors?.slice(0, 6).map((f) => `${f.title}: ${f.summary}`) ?? [];
  }

  if (domains.includes("trust") && analysis?.trust) {
    pkg.trust = {
      available: true,
      band: analysis.trust.trustBand ? trustBandLabel(analysis.trust.trustBand) : null,
      summary:
        analysis.trust.whySeeingThis?.length > 0
          ? analysis.trust.whySeeingThis.join(" ")
          : analysis.trust.trustLabel ?? null,
    };
  }

  if (domains.includes("lessonsLearned")) {
    pkg.lessonsLearned = {
      available: lessons.length > 0,
      items: lessons.slice(0, 5).map((l) => ({
        title: l.title,
        summary: l.summary,
        category: l.category,
      })),
    };
    if (!pkg.lessonsLearned.available) {
      evidenceGaps.push("No organisation lessons learned are available yet.");
    }
  }

  if (domains.includes("similarProjects") && similarProjects) {
    pkg.similarProjects = {
      available: similarProjects.matches.length > 0,
      items: similarProjects.matches.slice(0, 6).map((m) => ({
        projectName: m.projectName,
        similarityPhrase: similarityPhrase(m.similarityScore),
        explanations: m.explanations ?? [],
      })),
    };
    if (!pkg.similarProjects.available) {
      evidenceGaps.push("No similar completed projects identified yet.");
    }
  }

  return pkg;
}

export type { AskRanaEvidenceDomain };
