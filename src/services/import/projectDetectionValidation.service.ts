import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { detectProjectFromXer } from "./projectDetection.service.js";
import type {
  DatasetValidationSummary,
  DetectionConfidence,
  DetectionMetrics,
  ExpectedProjectMetadata,
  ExpectedResultsFile,
  FieldTrace,
  FieldValidationResult,
  FieldValidationStatus,
  ProjectDetectionResult,
  ValidationReport,
} from "./projectDetection.types.js";
import type { DetectedField } from "./projectDetection.types.js";

function normalizeValue(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

function valuesMatch(expected: string | null, detected: string | null): boolean {
  if (expected == null && detected == null) return true;
  if (expected == null || detected == null) return false;
  return expected.toLowerCase() === detected.toLowerCase();
}

function confidenceScore(c: DetectionConfidence): number {
  switch (c) {
    case "high":
      return 1;
    case "medium":
      return 0.66;
    case "low":
      return 0.33;
    default:
      return 0;
  }
}

function fieldStatus(
  expected: string | null,
  detected: string | null,
  match: boolean
): FieldValidationStatus {
  if (expected == null) return "skipped";
  if (match) return "passed";
  if (detected == null) return "partial";
  return "failed";
}

export function validateDetectionAgainstExpected(
  detection: ProjectDetectionResult,
  expected: ExpectedProjectMetadata
): FieldValidationResult[] {
  const results: FieldValidationResult[] = [];

  const checks: {
    field: FieldValidationResult["field"];
    expectedVal: string | null;
    detectedField: DetectedField;
  }[] = [];

  if ("projectName" in expected) {
    checks.push({
      field: "projectName",
      expectedVal: normalizeValue(expected.projectName),
      detectedField: detection.projectName,
    });
  }
  if ("projectType" in expected) {
    checks.push({
      field: "projectType",
      expectedVal: normalizeValue(expected.projectType),
      detectedField: detection.projectType,
    });
  }
  if ("client" in expected || "clientType" in expected) {
    checks.push({
      field: "clientType",
      expectedVal: normalizeValue(expected.client ?? expected.clientType),
      detectedField: detection.clientType,
    });
  }
  if ("stage" in expected) {
    checks.push({
      field: "stage",
      expectedVal: normalizeValue(expected.stage),
      detectedField: detection.stage,
    });
  }
  if ("complexity" in expected) {
    checks.push({
      field: "complexity",
      expectedVal: normalizeValue(expected.complexity),
      detectedField: detection.complexity,
    });
  }

  for (const { field, expectedVal, detectedField } of checks) {
    const detectedVal = normalizeValue(detectedField?.value);
    const match = valuesMatch(expectedVal, detectedVal);
    const status = fieldStatus(expectedVal, detectedVal, match);

    let reason = detectedField?.reason ?? "";
    if (status === "failed" && detectedVal && expectedVal) {
      reason = `${detectedField?.reason ?? ""} Expected "${expectedVal}" but detected "${detectedVal}".`.trim();
    } else if (status === "partial") {
      reason = `No evidence found for expected value "${expectedVal}". ${detectedField?.reason ?? ""}`.trim();
    } else if (status === "failed" && !detectedVal) {
      reason = `Expected "${expectedVal}" but no value was detected. ${detectedField?.reason ?? ""}`.trim();
    }

    results.push({
      field,
      detected: detectedVal,
      expected: expectedVal,
      status,
      match,
      confidence: detectedField?.confidence ?? "none",
      reason,
      evidence: detectedField?.trace ?? emptyTrace(),
    });
  }

  return results;
}

function emptyTrace(): FieldTrace {
  return { sourcesSearched: [], confidenceReasoning: "", evidenceSummary: [] };
}

export function computeMetricsFromFields(
  fields: FieldValidationResult[],
  detectionTimeMs: number
): DetectionMetrics {
  const evaluated = fields.filter((f) => f.status !== "skipped");
  const passed = evaluated.filter((f) => f.status === "passed");
  const failed = evaluated.filter((f) => f.status === "failed");
  const partial = evaluated.filter((f) => f.status === "partial");

  const byField = (name: FieldValidationResult["field"]) =>
    evaluated.filter((f) => f.field === name);

  const accuracy = (subset: FieldValidationResult[]) =>
    subset.length === 0 ? 1 : subset.filter((f) => f.match).length / subset.length;

  const falsePositives = evaluated.filter((f) => f.detected != null && f.expected != null && !f.match);
  const falseNegatives = evaluated.filter((f) => f.detected == null && f.expected != null);

  const avgConf =
    evaluated.length === 0
      ? 0
      : evaluated.reduce((s, f) => s + confidenceScore(f.confidence), 0) / evaluated.length;

  return {
    projectNameAccuracy: accuracy(byField("projectName")),
    projectTypeAccuracy: accuracy(byField("projectType")),
    clientAccuracy: accuracy(byField("clientType")),
    stageAccuracy: accuracy(byField("stage")),
    complexityAccuracy: accuracy(byField("complexity")),
    overallAccuracy: evaluated.length === 0 ? 1 : passed.length / evaluated.length,
    averageConfidence: avgConf,
    averageDetectionTimeMs: detectionTimeMs,
    falsePositiveRate: evaluated.length === 0 ? 0 : falsePositives.length / evaluated.length,
    falseNegativeRate: evaluated.length === 0 ? 0 : falseNegatives.length / evaluated.length,
    fieldsEvaluated: evaluated.length,
    fieldsPassed: passed.length,
    fieldsFailed: failed.length,
    fieldsPartial: partial.length,
  };
}

export function validateXerAgainstExpected(
  buffer: Buffer,
  fileName: string,
  datasetId: string,
  expectedFile: ExpectedResultsFile
): ValidationReport {
  const started = performance.now();
  const detection = detectProjectFromXer({ buffer, fileName });
  const fields = validateDetectionAgainstExpected(detection, expectedFile.expected);
  const detectionTimeMs = Math.round(performance.now() - started);
  const metrics = computeMetricsFromFields(fields, detection.detectionTimeMs);

  const minAccuracy = expectedFile.minAccuracy ?? 1;
  const evaluated = fields.filter((f) => f.status !== "skipped");
  const passed =
    evaluated.length === 0
      ? true
      : metrics.overallAccuracy >= minAccuracy && fields.every((f) => f.status !== "failed");

  return {
    datasetId,
    xerFile: fileName,
    description: expectedFile.description,
    timestamp: new Date().toISOString(),
    detection,
    fields,
    metrics,
    detectionTimeMs,
    passed,
  };
}

function findXerFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".xer"))
    .map((f) => join(dir, f));
}

export function loadExpectedResults(datasetDir: string): ExpectedResultsFile | null {
  const path = join(datasetDir, "expected-results.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ExpectedResultsFile;
}

export function validateDataset(datasetDir: string): ValidationReport[] {
  const datasetId = basename(datasetDir);
  const expectedFile = loadExpectedResults(datasetDir);
  if (!expectedFile) return [];

  const xerFiles = findXerFiles(datasetDir);
  if (xerFiles.length === 0) return [];

  const primary = expectedFile.primaryFile
    ? xerFiles.find((f) => basename(f) === expectedFile.primaryFile)
    : xerFiles[0];

  const targets = primary ? [primary] : xerFiles;
  return targets.map((xerPath) => {
    const buffer = readFileSync(xerPath);
    return validateXerAgainstExpected(buffer, basename(xerPath), datasetId, expectedFile);
  });
}

export function validateAllDatasets(validationRoot: string): DatasetValidationSummary {
  if (!existsSync(validationRoot)) {
    return { datasets: [], aggregate: emptyMetrics(), allPassed: true };
  }

  const datasetDirs = readdirSync(validationRoot)
    .map((name) => join(validationRoot, name))
    .filter((p) => statSync(p).isDirectory());

  const datasets = datasetDirs.flatMap((dir) => validateDataset(dir));
  const aggregate = aggregateMetrics(datasets);

  return {
    datasets,
    aggregate,
    allPassed: datasets.length === 0 ? true : datasets.every((d) => d.passed),
  };
}

function emptyMetrics(): DetectionMetrics {
  return {
    projectNameAccuracy: 1,
    projectTypeAccuracy: 1,
    clientAccuracy: 1,
    stageAccuracy: 1,
    complexityAccuracy: 1,
    overallAccuracy: 1,
    averageConfidence: 0,
    averageDetectionTimeMs: 0,
    falsePositiveRate: 0,
    falseNegativeRate: 0,
    fieldsEvaluated: 0,
    fieldsPassed: 0,
    fieldsFailed: 0,
    fieldsPartial: 0,
  };
}

export function aggregateMetrics(reports: ValidationReport[]): DetectionMetrics {
  if (reports.length === 0) return emptyMetrics();
  const allFields = reports.flatMap((r) => r.fields);
  const avgTime = reports.reduce((s, r) => s + r.detectionTimeMs, 0) / reports.length;
  const base = computeMetricsFromFields(allFields, avgTime);
  return base;
}

export function listValidationDatasets(validationRoot: string): {
  id: string;
  hasExpected: boolean;
  xerCount: number;
  notes?: string;
}[] {
  if (!existsSync(validationRoot)) return [];
  return readdirSync(validationRoot)
    .map((name) => {
      const dir = join(validationRoot, name);
      if (!statSync(dir).isDirectory()) return null;
      const expected = loadExpectedResults(dir);
      return {
        id: name,
        hasExpected: expected != null,
        xerCount: findXerFiles(dir).length,
        notes: expected?.notes,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}
