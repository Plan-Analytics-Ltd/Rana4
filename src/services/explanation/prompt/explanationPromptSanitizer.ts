import type { ExplanationIntelligencePackage } from "../context/explanationContext.builder.js";
import type { ExplanationType } from "../types/explanationTypes.js";
import { formatClassificationLabel } from "../../intelligence/shared/durationEvidence.service.js";
import { trustBandLabel } from "../../intelligence/trust/intelligenceTrust.service.js";

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const CUID_PATTERN = /\bc[a-z0-9]{20,}\b/gi;

export const EXPLANATION_TYPE_PLANNER_LABELS: Record<ExplanationType, string> = {
  FLAGGED_DELIVERABLE: "Flagged deliverable",
  RECOMMENDATION: "Recommendations",
  PREDICTED_OUTCOME: "Predicted outcome",
  BENCHMARK: "Benchmark comparison",
  FORECAST_RELIABILITY: "Forecast reliability",
  TRUST_SCORE: "Trust assessment",
  KEY_FACTORS: "Key factors",
  DELIVERABLE_SUMMARY: "Deliverable summary",
};

const OUTLIER_STATUS_LABELS: Record<string, string> = {
  NORMAL: "Within normal range",
  SLIGHTLY_HIGH: "Slightly above historical norms",
  HIGH: "Above historical norms",
  RED_FLAG: "Significantly above historical norms (red flag)",
  EXTREME_OUTLIER: "Extreme outlier compared to historical norms",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  LOW: "Low confidence",
  MEDIUM: "Medium confidence",
  HIGH: "High confidence",
};

const SEVERITY_LABELS: Record<string, string> = {
  LOW: "Low severity",
  MEDIUM: "Medium severity",
  HIGH: "High severity",
};

/** Convert SCREAMING_SNAKE enum values to planner-readable labels. */
export function formatPlannerLabel(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "Not specified";
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatConfidenceLevel(value: string | null | undefined): string {
  const key = String(value ?? "").trim().toUpperCase();
  return CONFIDENCE_LABELS[key] ?? formatPlannerLabel(value);
}

export function formatSeverityLevel(value: string | null | undefined): string {
  const key = String(value ?? "").trim().toUpperCase();
  return SEVERITY_LABELS[key] ?? formatPlannerLabel(value);
}

export function formatOutlierStatus(value: string | null | undefined): string {
  const key = String(value ?? "").trim().toUpperCase();
  return OUTLIER_STATUS_LABELS[key] ?? formatPlannerLabel(value);
}

function line(label: string, value: string | number | null | undefined): string | null {
  if (value == null || value === "" || value === "—") return null;
  return `- ${label}: ${value}`;
}

function section(title: string, lines: Array<string | null | undefined>): string {
  const body = lines.filter((l): l is string => Boolean(l));
  if (body.length === 0) return "";
  return `## ${title}\n${body.join("\n")}`;
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function formatEvidenceItems(items: { label: string; value: string | number }[]): string[] {
  return items.map((e) => `${e.label}: ${e.value}`);
}

/** Rough token estimate for reporting (chars / 4). */
export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Detect implementation identifiers that should not appear in LLM prompts. */
export function containsInternalIdentifiers(text: string): boolean {
  if (UUID_PATTERN.test(text)) return true;
  UUID_PATTERN.lastIndex = 0;
  if (CUID_PATTERN.test(text)) return true;
  CUID_PATTERN.lastIndex = 0;
  if (/"id"\s*:/i.test(text)) return true;
  if (/\b(projectId|companyId|deliverableId|activityId|snapshotId|fragnetId)\b/i.test(text)) return true;
  if (/###\s+\w+\n\{/m.test(text) || /^\s*\{/m.test(text)) return false;
  if (text.includes("```json") || text.includes('"findingType"')) return true;
  return false;
}

/**
 * Build a planner-readable briefing for the LLM.
 * Intelligence content is preserved; implementation details are stripped.
 */
export function buildLlmBriefingContext(pkg: ExplanationIntelligencePackage): string {
  const sections: string[] = [];

  const classification = pkg.deliverable.classification
    ? formatClassificationLabel(String(pkg.deliverable.classification))
    : "Unclassified";

  sections.push(
    section("Current Deliverable", [
      line("Name", pkg.deliverable.name),
      line("Classification", classification),
      line("Current duration", pkg.currentDurationDays != null ? `${pkg.currentDurationDays} days` : null),
    ])
  );

  if (pkg.outlier) {
    sections.push(
      section("Schedule Comparison", [
        line("Status", formatOutlierStatus(pkg.outlier.status)),
        pkg.outlier.differenceFromAveragePercent != null
          ? line("Difference from historical average", `${pkg.outlier.differenceFromAveragePercent}%`)
          : null,
        pkg.outlier.differenceFromMedianPercent != null
          ? line("Difference from historical median", `${pkg.outlier.differenceFromMedianPercent}%`)
          : null,
      ])
    );
  }

  if (pkg.benchmark) {
    const b = pkg.benchmark;
    sections.push(
      section("Historical Benchmark", [
        line("Sample size", b.sampleSize),
        line("Average duration", b.averageDuration != null ? `${b.averageDuration} days` : null),
        line("Median duration", b.medianDuration != null ? `${b.medianDuration} days` : null),
        line("Typical range", b.minimumDuration != null && b.maximumDuration != null ? `${b.minimumDuration}–${b.maximumDuration} days` : null),
        line("Confidence", formatConfidenceLevel(b.confidenceLevel)),
        b.notes?.length ? line("Notes", b.notes.join("; ")) : null,
      ])
    );
  }

  const evidenceLines = dedupeLines([
    pkg.evidenceSummary.sampleSize > 0 ? `Comparable observations: ${pkg.evidenceSummary.sampleSize}` : "",
    pkg.evidenceSummary.matchedProjectCount > 0
      ? `Historical projects compared: ${pkg.evidenceSummary.matchedProjectCount}`
      : "",
    pkg.evidenceSummary.classificationMatchRate != null
      ? `Classification match rate: ${Math.round(pkg.evidenceSummary.classificationMatchRate * 100)}%`
      : "",
  ]);
  if (evidenceLines.length > 0) {
    sections.push(`## Historical Evidence\n${bulletList(evidenceLines)}`);
  }

  const historicalNames = dedupeLines(
    (pkg.evidence?.matchedDeliverables ?? [])
      .slice(0, 8)
      .map((m) => {
        const project = m.projectName ? String(m.projectName) : "Historical project";
        const deliverable = m.deliverableName ? String(m.deliverableName) : "Comparable deliverable";
        const duration = m.durationDays != null ? `${m.durationDays} days` : "duration unknown";
        const state = m.programmeState ? formatPlannerLabel(String(m.programmeState)) : null;
        return state
          ? `${deliverable} (${project}) — ${duration}, ${state} programme`
          : `${deliverable} (${project}) — ${duration}`;
      })
  );
  if (historicalNames.length > 0) {
    sections.push(`## Comparable Historical Deliverables\n${bulletList(historicalNames)}`);
  }

  if (pkg.observations.length > 0) {
    const obs = pkg.observations.map((o) => {
      const parts = [
        o.title,
        o.summary,
        `Severity: ${formatSeverityLevel(o.severity)}`,
        `Confidence: ${formatConfidenceLevel(o.confidence)}`,
      ];
      if (o.reasoning.length > 0) parts.push(`Reasoning: ${o.reasoning.join(" ")}`);
      const evidence = formatEvidenceItems(o.evidence);
      if (evidence.length > 0) parts.push(evidence.join("; "));
      return parts.filter(Boolean).join(". ");
    });
    sections.push(`## Key Findings\n${bulletList(obs)}`);
  }

  if (pkg.keyFactors.length > 0) {
    const factors = pkg.keyFactors.map((f) => {
      const parts = [
        f.title,
        f.summary,
        `Impact: ${formatPlannerLabel(f.impactLevel)}`,
        `Confidence: ${formatConfidenceLevel(f.confidence)}`,
      ];
      if (f.reasoning.length > 0) parts.push(`Reasoning: ${f.reasoning.join(" ")}`);
      const evidence = formatEvidenceItems(f.evidence);
      if (evidence.length > 0) parts.push(evidence.join("; "));
      return parts.filter(Boolean).join(". ");
    });
    sections.push(`## Key Factors\n${bulletList(factors)}`);
  }

  if (pkg.forecastReliability) {
    const r = pkg.forecastReliability;
    sections.push(
      section("Forecast Reliability", [
        line("Assessment", r.reliabilityLabel ?? formatPlannerLabel(r.reliabilityBand)),
        line("Historical overrun frequency", r.overrunFrequency != null ? `${r.overrunFrequency}%` : null),
        line("On-target frequency", r.onTargetFrequency != null ? `${r.onTargetFrequency}%` : null),
        line("Sample size", r.sampleSize),
        line("Confidence", formatConfidenceLevel(r.confidenceLevel)),
      ])
    );
  }

  if (pkg.outcomePrediction) {
    const p = pkg.outcomePrediction;
    sections.push(
      section("Outcome Prediction", [
        line("Predicted range", p.rangeLabel),
        line("Most likely duration", p.predictedMostLikelyDuration != null ? `${p.predictedMostLikelyDuration} days` : null),
        line("Confidence", formatConfidenceLevel(p.predictionConfidenceLevel)),
        line("Evidence basis", p.evidenceCount != null ? `${p.evidenceCount} observations` : null),
        p.reasoning?.length ? line("Reasoning", p.reasoning.join(" ")) : null,
      ])
    );
  }

  if (pkg.recommendations.length > 0) {
    const recs = pkg.recommendations.map((r) => {
      const parts = [
        r.title,
        r.summary,
        r.recommendation,
        `Type: ${formatPlannerLabel(String(r.recommendationType))}`,
        `Severity: ${formatSeverityLevel(r.severity)}`,
        `Confidence: ${formatConfidenceLevel(r.confidenceLevel)}`,
      ];
      const evidence = formatEvidenceItems(r.supportingEvidence);
      if (evidence.length > 0) parts.push(evidence.join("; "));
      return parts.filter(Boolean).join(". ");
    });
    sections.push(`## Recommendations\n${bulletList(recs)}`);
  }

  if (pkg.trust) {
    const t = pkg.trust;
    sections.push(
      section("Trust Assessment", [
        line("Overall", t.trustLabel ?? trustBandLabel(t.trustBand)),
        line("Trust score", t.trustScore != null ? `${Math.round(t.trustScore * 100)}%` : null),
        line("Evidence strength", t.evidenceStrength?.strengthLabel),
        line("Knowledge coverage", t.knowledgeCoverage?.coverageLabel),
        line("Learning maturity", t.knowledgeCoverage?.learningMaturity ? formatPlannerLabel(t.knowledgeCoverage.learningMaturity) : null),
        t.whySeeingThis?.length ? line("Why you are seeing this", t.whySeeingThis.join(" ")) : null,
      ])
    );

    const traceSummaries = (t.recommendationTraceability?.sourceLayers ?? [])
      .map((layer) => `${layer.layer}: ${layer.summary} (${layer.status})`)
      .filter(Boolean);
    if (traceSummaries.length > 0) {
      sections.push(`## Evidence Traceability\n${bulletList(dedupeLines(traceSummaries))}`);
    }
  }

  const supporting = dedupeLines([
    ...formatEvidenceItems(pkg.trust?.supportingEvidence ?? []),
    ...pkg.recommendations.flatMap((r) => formatEvidenceItems(r.supportingEvidence)),
    ...pkg.keyFactors.flatMap((f) => formatEvidenceItems(f.evidence)),
  ]);
  if (supporting.length > 0) {
    sections.push(`## Supporting Evidence\n${bulletList(supporting)}`);
  }

  return sections.filter(Boolean).join("\n\n").trim();
}

/** Legacy JSON dump size estimate for before/after reporting in tests. */
export function buildLegacyJsonContextBlock(pkg: ExplanationIntelligencePackage): string {
  return JSON.stringify(
    {
      deliverable: pkg.deliverable,
      currentDurationDays: pkg.currentDurationDays,
      benchmark: pkg.benchmark,
      outlier: pkg.outlier,
      observations: pkg.observations,
      keyFactors: pkg.keyFactors,
      forecastReliability: pkg.forecastReliability,
      outcomePrediction: pkg.outcomePrediction,
      recommendations: pkg.recommendations,
      trust: pkg.trust,
      evidenceSummary: pkg.evidenceSummary,
      citationChain: pkg.citationChain,
      evidence: pkg.evidence,
    },
    null,
    2
  );
}
