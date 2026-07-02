import type { EvidenceDiversityMetrics } from "./evidenceDiversity.service.js";

/** Build planner-friendly evidence summary (replaces raw statistical counts). */
export function buildPlannerEvidenceSummary(args: {
  diversity: EvidenceDiversityMetrics;
  sectorLabel?: string | null;
  projectNames?: string[];
  medianDuration?: number | null;
  matchingConfidence?: string | null;
}): string {
  const parts: string[] = [];
  const { diversity } = args;

  parts.push(
    `Evidence comes from ${diversity.distinctDeliverables} historical deliverable${diversity.distinctDeliverables === 1 ? "" : "s"} across ${diversity.distinctRevisions} programme revision${diversity.distinctRevisions === 1 ? "" : "s"} within ${diversity.distinctProjects} completed project${diversity.distinctProjects === 1 ? "" : "s"}.`
  );

  if (args.sectorLabel) {
    parts.push(`Projects are primarily in the ${args.sectorLabel} sector.`);
  }

  if (diversity.distinctProjects === 1 && diversity.distinctRevisions > 1) {
    parts.push(
      "Multiple observations come from programme revisions on the same project rather than independent projects."
    );
  }

  if (args.medianDuration != null) {
    parts.push(`The typical historical duration is around ${Math.round(args.medianDuration)} days.`);
  }

  if (args.matchingConfidence) {
    parts.push(`Matching confidence: ${args.matchingConfidence}.`);
  }

  return parts.join(" ");
}

export function buildEvidenceMaturityExplanation(diversity: EvidenceDiversityMetrics): string {
  return `Evidence quantity: ${diversity.observationCount} observations. Evidence diversity: ${diversity.distinctProjects} independent project${diversity.distinctProjects === 1 ? "" : "s"}. Evidence maturity: ${diversity.maturityLabel}.`;
}

export function humanizeSimilarityRank(score: number, name: string): string {
  if (score >= 90) return `${name} — very strong match (${Math.round(score)}%)`;
  if (score >= 70) return `${name} — strong match (${Math.round(score)}%)`;
  if (score >= 50) return `${name} — partial match (${Math.round(score)}%)`;
  return `${name} — weak match (${Math.round(score)}%)`;
}
