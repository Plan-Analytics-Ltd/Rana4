export type DetectionConfidence = "high" | "medium" | "low" | "none";

export type DetectionSourceKind =
  | "project_metadata"
  | "project_properties"
  | "wbs"
  | "activity_names"
  | "activity_descriptions"
  | "activity_codes"
  | "calendars"
  | "resources"
  | "filename";

export type SourceSearchResult = {
  kind: DetectionSourceKind;
  label: string;
  searched: boolean;
  itemCount: number;
};

export type KeywordHit = {
  pattern: string;
  count: number;
  source: DetectionSourceKind;
};

export type KeywordMatchEvidence = {
  label: string;
  score: number;
  hits: number;
  matchedKeywords: KeywordHit[];
  sources: DetectionSourceKind[];
};

export type FieldTrace = {
  sourcesSearched: SourceSearchResult[];
  matchedKeywords?: KeywordMatchEvidence[];
  rejectedMatches?: KeywordMatchEvidence[];
  ignoredMatches?: KeywordMatchEvidence[];
  conflictResolution?: string;
  confidenceReasoning: string;
  evidenceSummary: string[];
  rawSignals?: Record<string, unknown>;
};

export type DetectedField = {
  value: string | null;
  confidence: DetectionConfidence;
  reason: string;
  /** Short UX label, e.g. "Detected from Primavera project metadata." */
  source: string;
  needsConfirmation: boolean;
  trace: FieldTrace;
};

export type ComplexityDetail = {
  score: number;
  maxScore: number;
  band: string;
  factors: { name: string; value: number | string; contribution: number; maxContribution: number }[];
};

export type ProjectDetectionReadiness = {
  ready: boolean;
  summary: string;
  missingFields: string[];
};

export type ProjectDetectionResult = {
  projectName: DetectedField;
  clientType: DetectedField;
  projectType: DetectedField;
  stage: DetectedField;
  complexity: DetectedField & { complexityDetail?: ComplexityDetail };
  readiness: ProjectDetectionReadiness;
  detectionTimeMs: number;
};

export type XerDetectionInput = {
  buffer: Buffer;
  fileName: string;
  activityCount?: number;
  relationshipCount?: number;
  wbsCount?: number;
  calendarCount?: number;
  resourceCount?: number;
};

export type ExpectedProjectMetadata = {
  projectName?: string | null;
  projectType?: string | null;
  client?: string | null;
  clientType?: string | null;
  stage?: string | null;
  complexity?: string | null;
  description?: string | null;
};

export type ExpectedResultsFile = {
  description?: string;
  primaryFile?: string;
  expected: ExpectedProjectMetadata;
  notes?: string;
  /** Minimum overall accuracy (0–1) for regression pass */
  minAccuracy?: number;
};

export type FieldValidationStatus = "passed" | "failed" | "partial" | "skipped";

export type FieldValidationResult = {
  field: keyof ExpectedProjectMetadata | "clientType";
  detected: string | null;
  expected: string | null;
  status: FieldValidationStatus;
  match: boolean;
  confidence: DetectionConfidence;
  reason: string;
  evidence: FieldTrace;
};

export type DetectionMetrics = {
  projectNameAccuracy: number;
  projectTypeAccuracy: number;
  clientAccuracy: number;
  stageAccuracy: number;
  complexityAccuracy: number;
  overallAccuracy: number;
  averageConfidence: number;
  averageDetectionTimeMs: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  fieldsEvaluated: number;
  fieldsPassed: number;
  fieldsFailed: number;
  fieldsPartial: number;
};

export type ValidationReport = {
  datasetId: string;
  xerFile: string;
  description?: string;
  timestamp: string;
  detection: ProjectDetectionResult;
  fields: FieldValidationResult[];
  metrics: DetectionMetrics;
  detectionTimeMs: number;
  passed: boolean;
};

export type DatasetValidationSummary = {
  datasets: ValidationReport[];
  aggregate: DetectionMetrics;
  allPassed: boolean;
};
