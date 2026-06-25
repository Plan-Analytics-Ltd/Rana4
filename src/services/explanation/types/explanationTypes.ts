/** Supported explanation request types — each maps to a prompt template. */
export const EXPLANATION_TYPES = [
  "FLAGGED_DELIVERABLE",
  "RECOMMENDATION",
  "PREDICTED_OUTCOME",
  "BENCHMARK",
  "FORECAST_RELIABILITY",
  "TRUST_SCORE",
  "KEY_FACTORS",
  "DELIVERABLE_SUMMARY",
] as const;

export type ExplanationType = (typeof EXPLANATION_TYPES)[number];

export function parseExplanationType(value: unknown): ExplanationType | null {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return EXPLANATION_TYPES.includes(normalized as ExplanationType)
    ? (normalized as ExplanationType)
    : null;
}

export type ExplanationRequest = {
  projectId: string;
  companyId: string;
  deliverableId: string;
  explanationType: ExplanationType;
  question?: string | null;
  selectedProjectIds?: string[];
};

export type ExplanationCitationLayer =
  | "HISTORICAL_EVIDENCE"
  | "BENCHMARK"
  | "FORECAST_RELIABILITY"
  | "OUTCOME_PREDICTION"
  | "OBSERVATION"
  | "KEY_FACTOR"
  | "RECOMMENDATION"
  | "TRUST";

export type ExplanationCitation = {
  id: string;
  layer: ExplanationCitationLayer;
  label: string;
  summary: string;
  evidenceCount?: number | null;
  confidenceLevel?: string | null;
  confidenceScore?: number | null;
  relatedIds?: string[];
};

export type ExplanationSource = {
  layer: ExplanationCitationLayer;
  reference: string;
  detail?: string;
};

export type ExplanationContextSummary = {
  deliverableId: string;
  deliverableName: string;
  classification: string | null;
  currentDurationDays: number | null;
  outlierStatus: string | null;
  benchmarkSampleSize: number;
  observationCount: number;
  keyFactorCount: number;
  recommendationCount: number;
  trustBand: string | null;
  trustScore: number | null;
  hasForecastReliability: boolean;
  hasPredictedOutcome: boolean;
};

export type GeneratedExplanationPrompt = {
  system: string;
  user: string;
};

export type ExplanationResultStatus =
  | "success"
  | "provider_not_configured"
  | "mock"
  | "disabled"
  | "not_ready"
  | "error";

export type ValidationResult = "PASS" | "WARNING" | "FAIL";

export type ExplanationReadiness = "READY" | "LIMITED" | "NOT_READY";

export type ValidationCheck = {
  id: string;
  label: string;
  result: ValidationResult;
  message: string;
};

export type ExplanationValidationReport = {
  readiness: ExplanationReadiness;
  score: number;
  issues: string[];
  passedChecks: ValidationCheck[];
  warningChecks: ValidationCheck[];
  failedChecks: ValidationCheck[];
};

export type ExplanationResult = {
  status: ExplanationResultStatus;
  explanationType: ExplanationType;
  question: string | null;
  explanation: string | null;
  confidence: string | null;
  citations: ExplanationCitation[];
  sources: ExplanationSource[];
  supportingEvidence: { label: string; value: string | number }[];
  generatedPrompt: GeneratedExplanationPrompt;
  contextSummary: ExplanationContextSummary;
  validation: ExplanationValidationReport;
  providerCalled: boolean;
  message?: string;
  providerId?: string;
};
