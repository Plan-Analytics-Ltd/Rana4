import type { ExplanationIntelligencePackage } from "./explanationContext.builder.js";
import type { ExplanationType } from "./explanationTypes.js";

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

export const NOT_READY_EXPLANATION_MESSAGE =
  "Rana4 does not currently have enough historical evidence to generate a reliable explanation for this deliverable.";

const MIN_SAMPLE_READY = 5;
const MIN_SAMPLE_LIMITED = 1;

function confidenceLevel(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function check(
  id: string,
  label: string,
  result: ValidationResult,
  message: string
): ValidationCheck {
  return { id, label, result, message };
}

function sampleSize(pkg: ExplanationIntelligencePackage): number {
  return pkg.evidenceSummary.sampleSize;
}

function hasBenchmark(pkg: ExplanationIntelligencePackage): boolean {
  return sampleSize(pkg) >= MIN_SAMPLE_LIMITED && pkg.benchmark != null;
}

function runCommonChecks(pkg: ExplanationIntelligencePackage): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const size = sampleSize(pkg);

  checks.push(
    hasBenchmark(pkg)
      ? check("benchmark_available", "Benchmark available", "PASS", "Historical benchmark data is present.")
      : check(
          "benchmark_available",
          "Benchmark available",
          "FAIL",
          "No benchmark comparison is available for this deliverable."
        )
  );

  if (size >= MIN_SAMPLE_READY) {
    checks.push(
      check(
        "sample_size_sufficient",
        "Historical sample size",
        "PASS",
        `${size} comparable deliverable observations available.`
      )
    );
  } else if (size >= MIN_SAMPLE_LIMITED) {
    checks.push(
      check(
        "sample_size_sufficient",
        "Historical sample size",
        "WARNING",
        `Historical sample size is low (${size} observation${size === 1 ? "" : "s"}).`
      )
    );
  } else {
    checks.push(
      check(
        "sample_size_sufficient",
        "Historical sample size",
        "FAIL",
        "Insufficient historical deliverable observations."
      )
    );
  }

  const benchmarkConfidence = confidenceLevel(pkg.benchmark?.confidenceLevel);
  if (!hasBenchmark(pkg)) {
    checks.push(
      check(
        "benchmark_confidence",
        "Benchmark confidence",
        "FAIL",
        "Benchmark confidence cannot be assessed without benchmark data."
      )
    );
  } else if (benchmarkConfidence === "LOW") {
    checks.push(
      check(
        "benchmark_confidence",
        "Benchmark confidence",
        "WARNING",
        "Benchmark confidence is low."
      )
    );
  } else {
    checks.push(
      check(
        "benchmark_confidence",
        "Benchmark confidence",
        "PASS",
        `Benchmark confidence is ${benchmarkConfidence || "acceptable"}.`
      )
    );
  }

  if (pkg.outcomePrediction) {
    const predConf = confidenceLevel(pkg.outcomePrediction.predictionConfidenceLevel);
    checks.push(
      predConf === "LOW"
        ? check(
            "prediction_confidence",
            "Prediction confidence",
            "WARNING",
            "Outcome prediction confidence is low."
          )
        : check(
            "prediction_confidence",
            "Prediction confidence",
            "PASS",
            `Outcome prediction confidence is ${predConf || "available"}.`
          )
    );
  } else {
    checks.push(
      check(
        "prediction_confidence",
        "Prediction confidence",
        "WARNING",
        "Outcome prediction is not available."
      )
    );
  }

  if (pkg.forecastReliability) {
    const relConf = confidenceLevel(pkg.forecastReliability.confidenceLevel);
    checks.push(
      relConf === "LOW"
        ? check(
            "reliability_confidence",
            "Forecast reliability confidence",
            "WARNING",
            "Forecast reliability confidence is low."
          )
        : check(
            "reliability_confidence",
            "Forecast reliability confidence",
            "PASS",
            "Forecast reliability profile is available."
          )
    );
  } else {
    checks.push(
      check(
        "reliability_confidence",
        "Forecast reliability confidence",
        "WARNING",
        "Forecast reliability profile is not available."
      )
    );
  }

  if (pkg.trust) {
    const band = confidenceLevel(pkg.trust.trustBand);
    checks.push(
      band === "LOW" || band === "LIMITED"
        ? check("trust_available", "Trust profile", "WARNING", `Trust band is ${pkg.trust.trustBand}.`)
        : check("trust_available", "Trust profile", "PASS", "Trust and explainability profile is available.")
    );
  } else {
    checks.push(
      check("trust_available", "Trust profile", "WARNING", "Trust profile is not available.")
    );
  }

  if (pkg.recommendations.length > 0) {
    checks.push(
      check(
        "recommendation_available",
        "Recommendations",
        "PASS",
        `${pkg.recommendations.length} recommendation(s) available.`
      )
    );
  } else {
    checks.push(
      check("recommendation_available", "Recommendations", "WARNING", "No recommendations are available.")
    );
  }

  if (pkg.keyFactors.length > 0) {
    checks.push(
      check(
        "key_factors_available",
        "Key factors",
        "PASS",
        `${pkg.keyFactors.length} key factor(s) available.`
      )
    );
  } else {
    checks.push(
      check("key_factors_available", "Key factors", "WARNING", "No key factors are available.")
    );
  }

  if (pkg.observations.length > 0) {
    checks.push(
      check(
        "observations_available",
        "Observations",
        "PASS",
        `${pkg.observations.length} observation(s) available.`
      )
    );
  } else {
    checks.push(
      check("observations_available", "Observations", "WARNING", "No observations are available.")
    );
  }

  return checks;
}

/** Checks that block explanation for a given explanation type. */
function isBlockingFailure(checkId: string, explanationType: ExplanationType): boolean {
  switch (explanationType) {
    case "BENCHMARK":
      return checkId === "benchmark_available" || checkId === "sample_size_sufficient";
    case "PREDICTED_OUTCOME":
      return checkId === "prediction_available";
    case "RECOMMENDATION":
      return checkId === "recommendation_available";
    case "FORECAST_RELIABILITY":
      return checkId === "reliability_available";
    case "TRUST_SCORE":
      return checkId === "trust_available";
    case "KEY_FACTORS":
      return checkId === "key_factors_available";
    case "FLAGGED_DELIVERABLE":
      return checkId === "benchmark_available" || checkId === "sample_size_sufficient";
    case "DELIVERABLE_SUMMARY":
      return checkId === "intelligence_minimum";
    default:
      return false;
  }
}

function runTypeSpecificChecks(
  pkg: ExplanationIntelligencePackage,
  explanationType: ExplanationType
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  if (explanationType === "PREDICTED_OUTCOME") {
    checks.push(
      pkg.outcomePrediction
        ? check("prediction_available", "Outcome prediction", "PASS", "Outcome prediction is available.")
        : check(
            "prediction_available",
            "Outcome prediction",
            "FAIL",
            "Outcome prediction is not available for this deliverable."
          )
    );
  }

  if (explanationType === "RECOMMENDATION") {
    checks.push(
      pkg.recommendations.length > 0
        ? check("recommendation_available", "Recommendations", "PASS", "Recommendations are available.")
        : check(
            "recommendation_available",
            "Recommendations",
            "FAIL",
            "No recommendations are available to explain."
          )
    );
  }

  if (explanationType === "FORECAST_RELIABILITY") {
    checks.push(
      pkg.forecastReliability
        ? check(
            "reliability_available",
            "Forecast reliability",
            "PASS",
            "Forecast reliability profile is available."
          )
        : check(
            "reliability_available",
            "Forecast reliability",
            "FAIL",
            "Forecast reliability is not available for this deliverable."
          )
    );
  }

  if (explanationType === "TRUST_SCORE") {
    checks.push(
      pkg.trust
        ? check("trust_available", "Trust profile", "PASS", "Trust profile is available.")
        : check(
            "trust_available",
            "Trust profile",
            "FAIL",
            "Trust profile is not available for this deliverable."
          )
    );
  }

  if (explanationType === "KEY_FACTORS") {
    const hasFactors = pkg.keyFactors.length > 0;
    checks.push(
      hasFactors
        ? check("key_factors_available", "Key factors", "PASS", "Key factors are available.")
        : check(
            "key_factors_available",
            "Key factors",
            "FAIL",
            "No key factors are available to explain."
          )
    );
  }

  if (explanationType === "DELIVERABLE_SUMMARY") {
    const hasMinimum =
      hasBenchmark(pkg) ||
      pkg.observations.length > 0 ||
      pkg.recommendations.length > 0 ||
      pkg.keyFactors.length > 0;
    checks.push(
      hasMinimum
        ? check(
            "intelligence_minimum",
            "Minimum intelligence",
            "PASS",
            "At least one intelligence layer is available for summary."
          )
        : check(
            "intelligence_minimum",
            "Minimum intelligence",
            "FAIL",
            "No sufficient intelligence layers are available for a summary."
          )
    );
  }

  return checks;
}

function dedupeChecks(checks: ValidationCheck[]): ValidationCheck[] {
  const byId = new Map<string, ValidationCheck>();
  for (const c of checks) {
    const existing = byId.get(c.id);
    if (!existing) {
      byId.set(c.id, c);
      continue;
    }
    const rank = { FAIL: 3, WARNING: 2, PASS: 1 };
    if (rank[c.result] > rank[existing.result]) {
      byId.set(c.id, c);
    }
  }
  return [...byId.values()];
}

function computeScore(checks: ValidationCheck[]): number {
  if (checks.length === 0) return 0;
  let points = 0;
  for (const c of checks) {
    if (c.result === "PASS") points += 1;
    else if (c.result === "WARNING") points += 0.5;
  }
  return Math.round((points / checks.length) * 100) / 100;
}

function deriveReadiness(
  checks: ValidationCheck[],
  explanationType: ExplanationType
): ExplanationReadiness {
  const failedChecks = checks.filter((c) => c.result === "FAIL");
  const blockingFailures = failedChecks.filter((c) => isBlockingFailure(c.id, explanationType));
  if (blockingFailures.length > 0) return "NOT_READY";

  const warningChecks = checks.filter((c) => c.result === "WARNING");
  const sampleWarning = checks.find((c) => c.id === "sample_size_sufficient" && c.result === "WARNING");
  if (warningChecks.length > 0 || sampleWarning) return "LIMITED";

  const score = computeScore(checks);
  if (score >= 0.85) return "READY";
  if (score >= 0.45) return "LIMITED";
  return "NOT_READY";
}

/**
 * Validate intelligence context before prompt generation.
 * Deterministic — does not call any external services.
 */
export function validateExplanationContext(
  pkg: ExplanationIntelligencePackage,
  explanationType: ExplanationType
): ExplanationValidationReport {
  const checks = dedupeChecks([...runCommonChecks(pkg), ...runTypeSpecificChecks(pkg, explanationType)]);

  const passedChecks = checks.filter((c) => c.result === "PASS");
  const warningChecks = checks.filter((c) => c.result === "WARNING");
  const failedChecks = checks.filter((c) => c.result === "FAIL");
  const readiness = deriveReadiness(checks, explanationType);
  const score = computeScore(checks);

  const issues = [
    ...failedChecks.map((c) => c.message),
    ...warningChecks.map((c) => c.message),
  ];

  return {
    readiness,
    score,
    issues,
    passedChecks,
    warningChecks,
    failedChecks,
  };
}

export function shouldInvokeExplanationProvider(readiness: ExplanationReadiness): boolean {
  return readiness !== "NOT_READY";
}
