import type { DeliverableEvolution } from "./deliverableEvolution.service.js";

export type OrganisationalPatternType =
  | "REPEATED_SCOPE_GROWTH"
  | "REPEATED_DURATION_REDUCTION"
  | "REPEATED_PROLONGED_COMPLETION"
  | "HIGH_REVISION_VOLATILITY"
  | "FREQUENT_UNDERESTIMATION";

export type OrganisationalPattern = {
  type: OrganisationalPatternType;
  label: string;
  summary: string;
  deliverableName: string;
  classification: string | null;
  projectCount: number;
  occurrenceCount: number;
};

/** Detect recurring organisational patterns from deliverable evolution records. */
export function detectOrganisationalPatterns(
  records: Array<{
    deliverableName: string;
    classification: string | null;
    projectId: string;
    evolution: DeliverableEvolution;
  }>
): OrganisationalPattern[] {
  const patterns: OrganisationalPattern[] = [];
  const byName = new Map<string, typeof records>();

  for (const r of records) {
    const key = r.deliverableName.trim().toLowerCase();
    const bucket = byName.get(key) ?? [];
    bucket.push(r);
    byName.set(key, bucket);
  }

  for (const [, group] of byName) {
    if (group.length === 0) continue;
    const sample = group[0]!;
    const projects = new Set(group.map((g) => g.projectId));

    const scopeGrowth = group.filter(
      (g) => g.evolution.trend === "GROWING" && (g.evolution.growthPercent ?? 0) >= 20
    );
    if (scopeGrowth.length >= 2) {
      patterns.push({
        type: "REPEATED_SCOPE_GROWTH",
        label: "Repeated scope growth",
        summary: `${sample.deliverableName} has repeatedly expanded in duration across programme revisions.`,
        deliverableName: sample.deliverableName,
        classification: sample.classification,
        projectCount: projects.size,
        occurrenceCount: scopeGrowth.length,
      });
    }

    const reductions = group.filter(
      (g) => g.evolution.trend === "SHRINKING" || (g.evolution.reductionPercent ?? 0) >= 15
    );
    if (reductions.length >= 2) {
      patterns.push({
        type: "REPEATED_DURATION_REDUCTION",
        label: "Repeated duration reduction",
        summary: `${sample.deliverableName} has frequently reduced before completion across historical programmes.`,
        deliverableName: sample.deliverableName,
        classification: sample.classification,
        projectCount: projects.size,
        occurrenceCount: reductions.length,
      });
    }

    const volatile = group.filter((g) => g.evolution.trend === "OSCILLATING" && g.evolution.revisionCount >= 3);
    if (volatile.length >= 2) {
      patterns.push({
        type: "HIGH_REVISION_VOLATILITY",
        label: "High revision volatility",
        summary: `${sample.deliverableName} shows frequent duration changes across programme updates.`,
        deliverableName: sample.deliverableName,
        classification: sample.classification,
        projectCount: projects.size,
        occurrenceCount: volatile.length,
      });
    }

    const prolonged = group.filter(
      (g) =>
        g.evolution.maximumDuration != null &&
        g.evolution.finalDuration != null &&
        g.evolution.maximumDuration > g.evolution.finalDuration * 1.5
    );
    if (prolonged.length >= 2) {
      patterns.push({
        type: "REPEATED_PROLONGED_COMPLETION",
        label: "Repeated prolonged completion",
        summary: `${sample.deliverableName} has historically taken longer to complete than peak programme durations suggested.`,
        deliverableName: sample.deliverableName,
        classification: sample.classification,
        projectCount: projects.size,
        occurrenceCount: prolonged.length,
      });
    }
  }

  return patterns.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
}
