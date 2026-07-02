import type {
  DetectedField,
  DetectionConfidence,
  FieldTrace,
  KeywordMatchEvidence,
  ProjectDetectionResult,
  XerProjectPreview,
} from "@/lib/api";

export const CLIENT_UNKNOWN_REASON =
  "No client references were found in the Primavera project metadata, WBS, activity names, descriptions or codes. Manual confirmation is recommended.";

export const CLIENT_UNKNOWN_SOURCE =
  "Client left blank intentionally — no client evidence in the programme.";

export const NOT_IDENTIFIED_EXPLANATION =
  "No evidence was found within the uploaded programme. Manual confirmation is recommended.";

export function confidencePresentation(confidence: DetectionConfidence): {
  title: string;
  explanation: string;
} {
  switch (confidence) {
    case "high":
      return {
        title: "High confidence",
        explanation: "Detected consistently across multiple areas of the programme.",
      };
    case "medium":
      return {
        title: "Medium confidence",
        explanation: "Supported by programme content, but not repeated everywhere.",
      };
    case "low":
      return {
        title: "Low confidence",
        explanation: "Limited or indirect evidence — please confirm before importing.",
      };
    default:
      return {
        title: "Needs confirmation",
        explanation: "Not enough reliable evidence to suggest a value automatically.",
      };
  }
}

export function readinessHeadline(detection: ProjectDetectionResult): string {
  const { readiness } = detection;
  if (!readiness.ready) return "Project name needs confirmation";
  if (readiness.missingFields.length === 0) return "Programme analysed successfully";
  return "Programme ready for onboarding";
}

export function readinessBody(detection: ProjectDetectionResult): string {
  const { readiness } = detection;
  if (!readiness.ready) {
    return "Rana4 could not derive a reliable project name from the export. Please confirm the title before continuing.";
  }
  if (readiness.missingFields.length === 0) {
    return "The programme appears ready for import.";
  }
  return "Rana4 has analysed your programme. Review the highlighted fields before importing.";
}

export function buildStatusSummarySentence(detection: ProjectDetectionResult): string {
  const type = detection.projectType.value;
  const stage = detection.stage.value;

  if (type && stage) {
    return `Rana4 analysed your Primavera programme and identified a ${type} project in the ${stage} stage.`;
  }
  if (type) {
    return `Rana4 analysed your Primavera programme and identified a ${type} project.`;
  }
  if (stage) {
    return `Rana4 analysed your Primavera programme and identified a programme in the ${stage} stage.`;
  }
  return "Rana4 analysed your Primavera programme.";
}

export type ProgrammeAnalysisBullet = {
  text: string;
  needsReview: boolean;
};

export function buildProgrammeAnalysis(detection: ProjectDetectionResult): ProgrammeAnalysisBullet[] {
  const bullets: ProgrammeAnalysisBullet[] = [];

  if (detection.projectType.value) {
    bullets.push({ text: `${detection.projectType.value} project`, needsReview: detection.projectType.needsConfirmation });
  }
  if (detection.stage.value) {
    bullets.push({ text: `${detection.stage.value} stage`, needsReview: detection.stage.needsConfirmation });
  }
  if (detection.complexity.value) {
    bullets.push({
      text: `${detection.complexity.value} complexity`,
      needsReview: detection.complexity.needsConfirmation,
    });
  }
  if (detection.clientType.value) {
    bullets.push({ text: `Client: ${detection.clientType.value}`, needsReview: detection.clientType.needsConfirmation });
  } else {
    bullets.push({ text: "Client not identified", needsReview: true });
  }

  return bullets;
}

export type ManualReviewItem = {
  field: string;
  reason: string;
  action: string;
};

export function manualReviewItems(detection: ProjectDetectionResult): ManualReviewItem[] {
  const items: ManualReviewItem[] = [];

  if (!detection.clientType.value) {
    items.push({
      field: "Client",
      reason: "No client references were found within the Primavera programme.",
      action: "Select or confirm the client before importing.",
    });
  }
  if (detection.projectName.needsConfirmation) {
    items.push({
      field: "Project name",
      reason: detection.projectName.reason || "The programme title could not be confirmed with high confidence.",
      action: "Confirm the project name before importing.",
    });
  }
  if (detection.projectType.needsConfirmation && detection.projectType.value) {
    items.push({
      field: "Project type",
      reason: detection.projectType.reason || "Project type evidence was limited or conflicting.",
      action: "Confirm the project type before importing.",
    });
  }
  if (detection.stage.needsConfirmation && detection.stage.value) {
    items.push({
      field: "Stage",
      reason: detection.stage.reason || "Stage signals were mixed across the programme.",
      action: "Confirm the project stage before importing.",
    });
  }
  if (detection.complexity.needsConfirmation && detection.complexity.value) {
    items.push({
      field: "Complexity",
      reason: detection.complexity.reason || "Complexity could not be classified with high confidence.",
      action: "Confirm the complexity rating before importing.",
    });
  }

  return items;
}

/** @deprecated Use manualReviewItems for structured review sections */
export function manualReviewFields(detection: ProjectDetectionResult): string[] {
  return manualReviewItems(detection).map((i) => i.field);
}

export function displayValueForField(field: DetectedField | null, label: string): string {
  if (field?.value) return field.value;
  if (label.toLowerCase() === "client") return "Not identified";
  return "Not identified";
}

export function displaySummaryValue(field: DetectedField | null, label: string): string {
  if (field?.value) return field.value;
  if (label.toLowerCase() === "client") return "Needs confirmation";
  return "Not identified";
}

export function fieldOneLineExplanation(field: DetectedField | null, label: string): string {
  if (!field?.value) {
    if (label.toLowerCase() === "client") return NOT_IDENTIFIED_EXPLANATION;
    return field?.reason || NOT_IDENTIFIED_EXPLANATION;
  }
  if (field.confidence !== "none") {
    return confidencePresentation(field.confidence).explanation;
  }
  return field.reason || humanDecisionSummary(field);
}

export function humanDecisionSummary(field: DetectedField | null): string {
  if (!field?.value) {
    if (field?.trace?.confidenceReasoning) return field.trace.confidenceReasoning;
    return field?.reason ?? NOT_IDENTIFIED_EXPLANATION;
  }
  return field.reason || field.source;
}

export function alternativeConsidered(field: DetectedField | null): string | null {
  const runnerUp = field?.trace?.rejectedMatches?.[0];
  if (!runnerUp) return null;
  return runnerUp.label;
}

export function alternativeRejectionReason(field: DetectedField | null): string | null {
  const runnerUp = field?.trace?.rejectedMatches?.[0];
  if (!runnerUp) return null;
  if (field?.trace?.conflictResolution) return field.trace.conflictResolution;
  return `${runnerUp.label} had weaker or conflicting evidence in the programme.`;
}

export function complexityHumanSummary(
  detection: ProjectDetectionResult,
  preview: XerProjectPreview | null
): string[] {
  const lines: string[] = [];
  const trace = detection.complexity.trace;

  if (preview) {
    lines.push(`${preview.activityCount} activities`);
    lines.push(`${preview.relationshipCount} relationships`);
    lines.push(`${preview.wbsCount} WBS nodes`);
  }

  const workstreams = trace?.evidenceSummary?.find((e) => e.includes("workstream"));
  if (workstreams) lines.push(workstreams.replace(/^•\s*/, ""));
  const logic = trace?.evidenceSummary?.find((e) => /logic density/i.test(e));
  if (logic) lines.push(logic.replace(/^•\s*/, ""));

  if (lines.length === 0 && trace?.evidenceSummary?.length) {
    return trace.evidenceSummary.slice(0, 5);
  }
  return lines;
}

export function overallClassificationConfidence(detection: ProjectDetectionResult): string {
  const fields = [detection.projectType, detection.stage, detection.complexity].filter((f) => f.value);
  const confidences = fields.map((f) => f.confidence).filter((c) => c !== "none");
  if (confidences.length === 0) return "Needs confirmation";
  if (confidences.every((c) => c === "high")) return "High";
  if (confidences.some((c) => c === "low")) return "Low";
  if (confidences.some((c) => c === "medium")) return "Medium";
  return "High";
}

export type AnalysisSummaryLine = {
  label: string;
  complete: boolean;
};

export function buildAnalysisSummary(
  preview: XerProjectPreview,
  detection: ProjectDetectionResult
): AnalysisSummaryLine[] {
  const lines: AnalysisSummaryLine[] = [
    { label: `${preview.activityCount} activities analysed`, complete: preview.activityCount > 0 },
    { label: `${preview.relationshipCount} relationships analysed`, complete: preview.relationshipCount > 0 },
    { label: `${preview.wbsCount} WBS nodes analysed`, complete: preview.wbsCount > 0 },
    { label: `${preview.calendarCount} calendars analysed`, complete: preview.calendarCount > 0 },
    {
      label: `Classification confidence: ${overallClassificationConfidence(detection)}`,
      complete: true,
    },
  ];

  if (detection.detectionTimeMs != null) {
    lines.push({
      label: `Analysis completed in ${detection.detectionTimeMs} ms`,
      complete: true,
    });
  }

  return lines;
}

export function formatKeywordList(matches: KeywordMatchEvidence[] | undefined): string[] {
  if (!matches?.length) return [];
  return matches.slice(0, 4).map((m) => `${m.label} (${m.hits} reference${m.hits === 1 ? "" : "s"})`);
}

export function developerTraceLines(field: DetectedField | null, detectionTimeMs?: number): string[] {
  if (!field?.trace) return [];
  const t = field.trace;
  const lines: string[] = [];
  if (t.matchedKeywords?.length) {
    lines.push("Keyword matches:");
    for (const m of t.matchedKeywords.slice(0, 5)) {
      lines.push(`  • ${m.label} — score ${m.score}`);
      for (const k of m.matchedKeywords.slice(0, 3)) {
        lines.push(`      ${k.pattern} ×${k.count} [${k.source}]`);
      }
    }
  }
  if (t.rejectedMatches?.length) {
    lines.push("Runner-up:");
    for (const m of t.rejectedMatches.slice(0, 4)) {
      lines.push(`  • ${m.label} — score ${m.score}`);
    }
  }
  if (t.ignoredMatches?.length) {
    lines.push("Ignored / suppressed:");
    for (const m of t.ignoredMatches.slice(0, 4)) {
      lines.push(`  • ${m.label} — score ${m.score}`);
    }
  }
  if (t.conflictResolution) lines.push(`Conflict: ${t.conflictResolution}`);
  if (t.rawSignals) lines.push(`Raw signals: ${JSON.stringify(t.rawSignals)}`);
  if (detectionTimeMs != null) lines.push(`Detection time: ${detectionTimeMs}ms`);
  return lines;
}

export function traceSourcesSummary(trace: FieldTrace | undefined): string {
  if (!trace?.sourcesSearched?.length) return "";
  return trace.sourcesSearched
    .map((s) => `${s.searched && s.itemCount > 0 ? "✓" : "○"} ${s.label}`)
    .join(" · ");
}

export function formatPreviewDate(value: string | null | undefined): string {
  if (!value || value.trim() === "" || value === "—") return "Not available";
  return value;
}
