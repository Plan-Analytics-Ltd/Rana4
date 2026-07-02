import type {
  DatasetValidationSummary,
  DetectedField,
  DetectionMetrics,
  FieldTrace,
  FieldValidationResult,
  ProjectDetectionResult,
  SourceSearchResult,
  ValidationReport,
} from "./projectDetection.types.js";

function statusIcon(status: FieldValidationResult["status"]): string {
  switch (status) {
    case "passed":
      return "✓";
    case "failed":
      return "✗";
    case "partial":
      return "⚠";
    default:
      return "—";
  }
}

function fieldIcon(field: DetectedField): string {
  if (!field.value) return "?";
  if (field.needsConfirmation) return "⚠";
  if (field.confidence === "high") return "✓";
  if (field.confidence === "medium") return "⚠";
  return "?";
}

function formatSources(sources: SourceSearchResult[]): string {
  return sources
    .map((s) => `${s.searched && s.itemCount > 0 ? "✓" : s.searched ? "○" : "✗"} ${s.label}${s.itemCount > 0 ? ` (${s.itemCount})` : ""}`)
    .join("\n");
}

function formatKeywordEvidence(trace: FieldTrace): string {
  const lines: string[] = [];
  if (trace.matchedKeywords?.length) {
    lines.push("Matched:");
    for (const m of trace.matchedKeywords.slice(0, 5)) {
      lines.push(`  • ${m.label} — score ${m.score}, ${m.hits} hit(s)`);
      for (const k of m.matchedKeywords.slice(0, 4)) {
        lines.push(`      ${k.pattern} ×${k.count} [${k.source}]`);
      }
    }
  }
  if (trace.rejectedMatches?.length) {
    lines.push("Rejected / runner-up:");
    for (const m of trace.rejectedMatches.slice(0, 4)) {
      lines.push(`  • ${m.label} — score ${m.score}`);
    }
  }
  return lines.join("\n");
}

export function formatFieldDetectionSection(title: string, field: DetectedField): string {
  const lines = [
    title,
    "--------------------------------",
    `${fieldIcon(field)} ${field.value ?? "Unknown — needs confirmation"}`,
    field.value ? `Confidence: ${field.confidence}` : "",
    field.source,
    field.reason,
  ].filter(Boolean);

  if (field.trace.sourcesSearched.length) {
    lines.push("", "Sources searched:", formatSources(field.trace.sourcesSearched));
  }
  if (field.trace.confidenceReasoning) {
    lines.push("", "Confidence reasoning:", field.trace.confidenceReasoning);
  }
  if (field.trace.conflictResolution) {
    lines.push("", "Conflict resolution:", field.trace.conflictResolution);
  }
  const kw = formatKeywordEvidence(field.trace);
  if (kw) lines.push("", kw);
  if (field.trace.ignoredMatches?.length) {
    lines.push("", "Ignored / suppressed:");
    for (const m of field.trace.ignoredMatches.slice(0, 4)) {
      lines.push(`  • ${m.label} — score ${m.score}`);
    }
  }
  if (field.trace.evidenceSummary.length) {
    lines.push("", "Evidence:", ...field.trace.evidenceSummary.map((e) => `  • ${e}`));
  }

  return lines.join("\n");
}

export function formatDetectionReport(detection: ProjectDetectionResult, title = "Programme Detection Report"): string {
  const sections = [
    title,
    "================================",
    "",
    formatFieldDetectionSection("Project Name", detection.projectName),
    "",
    formatFieldDetectionSection("Project Type", detection.projectType),
    "",
    formatFieldDetectionSection("Client", detection.clientType),
    "",
    formatFieldDetectionSection("Stage", detection.stage),
    "",
    formatComplexitySection(detection),
    "",
    formatReadinessSection(detection),
    "",
    `Detection time: ${detection.detectionTimeMs}ms`,
  ];

  return sections.join("\n");
}

function formatComplexitySection(detection: ProjectDetectionResult): string {
  const field = detection.complexity;
  const detail = detection.complexity.complexityDetail;
  const lines = [
    "Complexity",
    "--------------------------------",
    `${fieldIcon(field)} ${field.value ?? "Unknown"}`,
  ];

  if (detail) {
    lines.push(`Score: ${detail.score}/${detail.maxScore}`);
    lines.push(field.reason);
    lines.push("", "Factors:");
    for (const f of detail.factors) {
      lines.push(`  • ${f.name}: ${f.value} → ${f.contribution}/${f.maxContribution} pts`);
    }
  } else {
    lines.push(field.reason);
  }

  if (field.trace.evidenceSummary.length) {
    lines.push("", "Evidence:", ...field.trace.evidenceSummary.map((e) => `  • ${e}`));
  }

  return lines.join("\n");
}

function formatReadinessSection(detection: ProjectDetectionResult): string {
  const { readiness } = detection;
  const review =
    readiness.missingFields.length > 0
      ? `Manual review recommended for:\n${readiness.missingFields.map((f) => `  • ${f}`).join("\n")}`
      : "All key fields detected.";

  return ["Readiness", "--------------------------------", readiness.summary, "", review].join("\n");
}

export function formatFieldValidationSection(result: FieldValidationResult): string {
  return [
    result.field,
    "--------------------------------",
    `Detected: ${result.detected ?? "Unknown"}`,
    `Expected: ${result.expected ?? "(not specified)"}`,
    `Status: ${result.status.toUpperCase()}`,
    `Match: ${result.match ? "YES" : "NO"}`,
    `Confidence: ${result.confidence}`,
    "",
    "Reason:",
    result.reason,
    "",
    "Evidence used:",
    formatKeywordEvidence(result.evidence) || result.evidence.evidenceSummary.map((e) => `  • ${e}`).join("\n") || "  (none)",
  ].join("\n");
}

export function formatValidationReport(report: ValidationReport): string {
  const sections = [
    `Validation Report — ${report.datasetId}`,
    `File: ${report.xerFile}`,
    report.description ?? "",
    `Timestamp: ${report.timestamp}`,
    "================================",
    "",
    ...report.fields.map((f) => formatFieldValidationSection(f)),
    "",
    formatMetricsSection(report.metrics),
    "",
    `Overall: ${report.passed ? "PASSED" : "FAILED"}`,
    `Detection time: ${report.detectionTimeMs}ms`,
  ].filter(Boolean);

  return sections.join("\n\n");
}

export function formatMetricsSection(metrics: DetectionMetrics): string {
  return [
    "Engine Metrics",
    "--------------------------------",
    `Overall accuracy: ${pct(metrics.overallAccuracy)}`,
    `Project name accuracy: ${pct(metrics.projectNameAccuracy)}`,
    `Project type accuracy: ${pct(metrics.projectTypeAccuracy)}`,
    `Client accuracy: ${pct(metrics.clientAccuracy)}`,
    `Stage accuracy: ${pct(metrics.stageAccuracy)}`,
    `Complexity accuracy: ${pct(metrics.complexityAccuracy)}`,
    `Average confidence: ${pct(metrics.averageConfidence)}`,
    `Average detection time: ${Math.round(metrics.averageDetectionTimeMs)}ms`,
    `False positive rate: ${pct(metrics.falsePositiveRate)}`,
    `False negative rate: ${pct(metrics.falseNegativeRate)}`,
    `Fields: ${metrics.fieldsPassed} passed, ${metrics.fieldsFailed} failed, ${metrics.fieldsPartial} partial (${metrics.fieldsEvaluated} evaluated)`,
  ].join("\n");
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function formatDatasetSummary(summary: DatasetValidationSummary): string {
  const parts = [
    "Project Detection Validation Summary",
    "====================================",
    `Datasets run: ${summary.datasets.length}`,
    `All passed: ${summary.allPassed ? "YES" : "NO"}`,
    "",
    formatMetricsSection(summary.aggregate),
  ];

  for (const report of summary.datasets) {
    parts.push("", "---", formatValidationReport(report));
  }

  return parts.join("\n");
}

export function formatValidationReportMarkdown(report: ValidationReport): string {
  const fieldRows = report.fields
    .map(
      (f) =>
        `| ${f.field} | ${f.detected ?? "—"} | ${f.expected ?? "—"} | ${statusIcon(f.status)} ${f.status} | ${f.confidence} |`
    )
    .join("\n");

  return [
    `# Validation: ${report.datasetId}`,
    "",
    `**File:** ${report.xerFile}  `,
    `**Result:** ${report.passed ? "PASSED" : "FAILED"}  `,
    `**Accuracy:** ${pct(report.metrics.overallAccuracy)}`,
    "",
    "| Field | Detected | Expected | Status | Confidence |",
    "|-------|----------|----------|--------|------------|",
    fieldRows,
    "",
    formatMetricsSection(report.metrics),
  ].join("\n");
}
