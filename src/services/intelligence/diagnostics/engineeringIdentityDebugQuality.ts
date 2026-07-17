/**
 * Identity Debug Export quality analysis — DEVELOPER ONLY.
 *
 * Pure, deterministic diagnostics layered on top of an already-resolved
 * Engineering Identity. Never changes production scoring, trust, or approval.
 */
import type { EngineeringIdentity } from "../taxonomy/engineeringIdentity.service.js";
import type { EngineeringIdentityValidation } from "../taxonomy/engineeringIdentityValidation.service.js";
import type { EngineeringTrustAssessment, EngineeringTrustReason } from "../taxonomy/engineeringTrust.service.js";
import type { EngineeringIdentityView } from "./engineeringBrainReview.js";
import type { WorkPackageTaxonomyResolution } from "../taxonomy/workPackageTaxonomy.service.js";
import {
  resolveEngineeringIdentity,
  compareEngineeringIdentities,
} from "../taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../taxonomy/engineeringIdentityValidation.service.js";
import { engineeringIdentityFingerprint } from "../taxonomy/engineeringTrust.service.js";
import { normaliseDeliverableNameForTaxonomy } from "../taxonomy/taxonomyMatching.utils.js";
import { extractDocumentType } from "../taxonomy/documentType.extraction.js";

type RuleTrace = {
  rule: string;
  type: "bonus" | "penalty" | "weight" | "info";
  contribution: number;
  evidence: string;
};

export type ConfidenceBreakdown = {
  startingConfidence: number;
  steps: Array<{ source: string; delta: number; runningTotal: number }>;
  finalConfidence: number;
};

export type StabilityAnalysis = {
  rating: "High" | "Medium" | "Low" | "Very Low";
  reason: string;
  sensitiveFields: string[];
  probes: Array<{
    variant: string;
    identityKey: string;
    changed: boolean;
    changedFields: string[];
  }>;
};

export type DiagnosticContradiction = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
};

export type RiskAssessment = {
  risk: "Low" | "Medium" | "High" | "Critical";
  score: number;
  drivers: string[];
};

export type KnowledgeCoverage = {
  matchedEntries: number;
  usedEntries: number;
  ignoredEntries: number;
  coverage: number;
  note: string;
};

export type NearestIdentity = {
  fingerprint: string;
  deliverableId: string | null;
  deliverableName: string;
  projectName: string;
  identityKey: string;
  similarity: number;
  differingFields: string[];
};

export type ExportSelfValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function identityKeyOf(identity: EngineeringIdentity): string {
  return [
    identity.discipline.id ?? "?",
    identity.engineeringObject.id ?? "?",
    identity.engineeringWork.id ?? "?",
  ].join(".");
}

function fieldDiffs(a: EngineeringIdentity, b: EngineeringIdentity): string[] {
  const fields: Array<[string, string | null, string | null]> = [
    ["discipline", a.discipline.id, b.discipline.id],
    ["engineeringObject", a.engineeringObject.id, b.engineeringObject.id],
    ["engineeringWork", a.engineeringWork.id, b.engineeringWork.id],
    ["deliverableType", a.deliverableType.id, b.deliverableType.id],
    ["lifecycleStage", a.lifecycleStage.id, b.lifecycleStage.id],
  ];
  return fields.filter(([, x, y]) => x !== y).map(([name]) => name);
}

/** Reconstruct how presentation confidence accumulated from component scores. */
export function buildConfidenceBreakdown(args: {
  identityView: EngineeringIdentityView;
  ruleTrace: RuleTrace[];
  validation: EngineeringIdentityValidation;
}): ConfidenceBreakdown {
  const start = 0.5;
  let running = start;
  const steps: ConfidenceBreakdown["steps"] = [];

  const push = (source: string, delta: number) => {
    running = Math.max(0, Math.min(1, round2(running + delta)));
    steps.push({ source, delta: round2(delta), runningTotal: running });
  };

  const d = args.identityView.discipline.confidence / 100;
  const o = args.identityView.engineeringObject.confidence / 100;
  const w = args.identityView.engineeringWork.confidence / 100;

  if (args.identityView.discipline.id) {
    push("Discipline Match", round2(d * 0.3));
  } else {
    push("Missing Discipline", -0.15);
  }
  if (args.identityView.engineeringObject.id) {
    push("Engineering Object Match", round2(o * 0.4));
  } else {
    push("Missing Engineering Object", -0.2);
  }
  if (args.identityView.engineeringWork.id) {
    push("Engineering Work Match", round2(w * 0.3));
  } else {
    push("Missing Engineering Work", -0.15);
  }

  if (args.identityView.lifecycleStage.id) {
    push("Lifecycle Present", 0.03);
  } else {
    push("Lifecycle Incomplete", -0.05);
  }

  if (args.identityView.deliverableType.id) {
    push("Deliverable Type Present", 0.02);
  }

  for (const penalty of args.ruleTrace.filter((r) => r.type === "penalty")) {
    push(penalty.rule, penalty.contribution);
  }

  if (!args.validation.valid) {
    push("Validation Failure", -0.15);
  }

  const finalFromView = round2(args.identityView.overallConfidence / 100);
  // Align final with presentation overall when close; keep step trail informative.
  const finalConfidence = Math.abs(running - finalFromView) < 0.25 ? finalFromView : running;
  if (finalConfidence !== running) {
    steps.push({
      source: "Align to presentation overall confidence",
      delta: round2(finalConfidence - running),
      runningTotal: finalConfidence,
    });
  }

  return {
    startingConfidence: start,
    steps,
    finalConfidence,
  };
}

/** Probe wording variants to see if the identity flips (diagnostic only). */
export function analyseIdentityStability(args: {
  deliverableName: string;
  taxonomyInput: Parameters<typeof resolveEngineeringIdentity>[0];
  identity: EngineeringIdentity;
}): StabilityAnalysis {
  const base = args.identity;
  const name = args.deliverableName;
  const variants = [
    name,
    name.replace(/\bModel(?:ling|ing)?\b/gi, "Model Development"),
    name.replace(/\bDetail(?:ing|ed)?\b/gi, "Details"),
    name.replace(/\bDrawing\b/gi, "Drawings"),
    `${name} Rev A`,
    name.toUpperCase() === name ? name.toLowerCase() : name.toUpperCase(),
  ].filter((v, i, arr) => v && v !== name && arr.indexOf(v) === i).slice(0, 4);

  const probes = variants.map((variant) => {
    const probed = enforceEngineeringIdentityValidation(
      resolveEngineeringIdentity({
        ...args.taxonomyInput,
        deliverableName: variant,
      })
    );
    const changedFields = fieldDiffs(base, probed);
    return {
      variant,
      identityKey: identityKeyOf(probed),
      changed: changedFields.length > 0 || probed.status !== base.status,
      changedFields,
    };
  });

  const sensitive = new Set<string>();
  for (const p of probes) for (const f of p.changedFields) sensitive.add(f);
  const flips = probes.filter((p) => p.changed).length;
  const identityFields = [
    base.discipline.id,
    base.engineeringObject.id,
    base.engineeringWork.id,
  ].filter(Boolean).length;

  let rating: StabilityAnalysis["rating"];
  let reason: string;
  if (probes.length === 0 || flips === 0) {
    rating = identityFields === 3 ? "High" : "Medium";
    reason =
      probes.length === 0
        ? "No wording variants available to probe; core identity fields are used as the stability basis."
        : "Wording variants resolved to the same identity signature.";
  } else if (flips === 1 && sensitive.size <= 1) {
    rating = "Medium";
    reason = `One wording variant changed ${[...sensitive].join(", ") || "status"}.`;
  } else if (flips <= 2) {
    rating = "Low";
    reason = `${flips} wording variants changed the identity (${[...sensitive].join(", ") || "status"}).`;
  } else {
    rating = "Very Low";
    reason = `Identity is highly sensitive to wording — ${flips}/${probes.length} probes changed the signature.`;
  }

  return { rating, reason, sensitiveFields: [...sensitive], probes };
}

export function detectDiagnosticContradictions(args: {
  identity: EngineeringIdentity;
  validation: EngineeringIdentityValidation;
  taxonomy: WorkPackageTaxonomyResolution;
}): DiagnosticContradiction[] {
  const out: DiagnosticContradiction[] = [];
  const { identity, validation, taxonomy } = args;

  for (const c of validation.contradictions) {
    out.push({
      severity: "error",
      code: c.rule,
      message: c.detail,
    });
  }

  if (identity.status === "INSUFFICIENT") {
    out.push({
      severity: "warning",
      code: "INSUFFICIENT_IDENTITY",
      message: "Core identity is incomplete (discipline, engineering object, or engineering work missing).",
    });
  }

  if (!identity.lifecycleStage.id) {
    out.push({
      severity: "info",
      code: "MISSING_LIFECYCLE",
      message: "Lifecycle stage was not resolved.",
    });
  }

  if (taxonomy.isUnknownWorkPackage) {
    out.push({
      severity: "warning",
      code: "UNKNOWN_WORK_PACKAGE",
      message: `Discipline known but no configured work package matched (“${taxonomy.diagnostics.workPackageReason}”).`,
    });
  }

  if (
    identity.discipline.id &&
    taxonomy.disciplineId &&
    identity.discipline.id !== taxonomy.disciplineId
  ) {
    out.push({
      severity: "warning",
      code: "DISCIPLINE_TAXONOMY_MISMATCH",
      message: `Identity discipline “${identity.discipline.id}” differs from taxonomy discipline “${taxonomy.disciplineId}”.`,
    });
  }

  const lifecycle = (identity.lifecycleStage.id ?? "").toLowerCase();
  const work = (identity.engineeringWork.id ?? "").toLowerCase();
  const wp = (taxonomy.workPackageLabel ?? "").toLowerCase();
  if (
    (lifecycle.includes("construction") || lifecycle.includes("install") || lifecycle.includes("commission")) &&
    (work.includes("design") || wp.includes("design") || work.includes("model"))
  ) {
    out.push({
      severity: "warning",
      code: "LIFECYCLE_WORK_MISMATCH",
      message: `Lifecycle indicates “${identity.lifecycleStage.label ?? lifecycle}” while work/package suggests design-stage work (“${identity.engineeringWork.label ?? (work || taxonomy.workPackageLabel || "design")}”).`,
    });
  }

  if (!identity.engineeringObject.id && identity.engineeringWork.id) {
    out.push({
      severity: "warning",
      code: "WORK_WITHOUT_OBJECT",
      message: "Engineering work resolved without an engineering object.",
    });
  }

  return out;
}

export function buildMissingEvidence(args: {
  identity: EngineeringIdentity;
  trust: EngineeringTrustAssessment;
  activityCount: number;
  historicalMatchCount: number;
  neighbourCount: number;
  knowledgeMatched: number;
}): string[] {
  const missing: string[] = [];
  const sources = new Set(args.identity.supportingEvidence.map((e) => e.source));

  if (!args.identity.discipline.id) missing.push("No resolved discipline");
  if (!args.identity.engineeringObject.id) missing.push("No resolved engineering object");
  if (!args.identity.engineeringWork.id) missing.push("No resolved engineering work");
  if (!args.identity.lifecycleStage.id) missing.push("No lifecycle evidence");
  if (!args.identity.deliverableType.id) missing.push("No deliverable type evidence");
  if (args.activityCount === 0 || !sources.has("RELATED_ACTIVITY")) {
    missing.push("No supporting activities");
  }
  if (args.historicalMatchCount === 0) missing.push("No historical evidence");
  if (args.neighbourCount === 0) missing.push("No similar neighbouring deliverables");
  if (args.knowledgeMatched === 0) missing.push("No Engineering Knowledge entries matched");
  if (args.identity.supportingEvidence.length < 3) {
    missing.push(`Insufficient supporting evidence signals (${args.identity.supportingEvidence.length} < 3)`);
  }
  for (const reason of args.trust.reasons) {
    const map: Record<EngineeringTrustReason, string> = {
      UNKNOWN_ENGINEERING_OBJECT: "Trust blocked: unknown engineering object",
      UNKNOWN_ENGINEERING_WORK: "Trust blocked: unknown engineering work",
      CONTRADICTORY_IDENTITY: "Trust blocked: contradictory identity",
      MULTIPLE_INTERPRETATIONS: "Trust blocked: multiple interpretations",
      INSUFFICIENT_EVIDENCE: "Trust blocked: insufficient evidence",
      VALIDATION_CONFLICT: "Trust blocked: validation conflict",
      REASONING_DISAGREEMENT: "Trust blocked: historical reasoning disagreement",
    };
    const line = map[reason];
    if (line && !missing.includes(line)) missing.push(line);
  }
  return missing;
}

export function assessIdentityRisk(args: {
  identity: EngineeringIdentity;
  trust: EngineeringTrustAssessment;
  stability: StabilityAnalysis;
  contradictions: DiagnosticContradiction[];
  historicalMatchCount: number;
  activityContributed: number;
}): RiskAssessment {
  let score = 0.15;
  const drivers: string[] = [];

  if (args.trust.state === "CONTRADICTORY") {
    score += 0.4;
    drivers.push("Identity is contradictory");
  } else if (args.trust.state === "NEEDS_REVIEW") {
    score += 0.2;
    drivers.push("Identity requires review");
  }

  if (!args.identity.engineeringObject.id) {
    score += 0.2;
    drivers.push("Unknown engineering object — wrong object would misroute comparisons");
  }
  if (!args.identity.engineeringWork.id) {
    score += 0.1;
    drivers.push("Unknown engineering work");
  }
  if (args.stability.rating === "Very Low") {
    score += 0.2;
    drivers.push("Very low wording stability");
  } else if (args.stability.rating === "Low") {
    score += 0.12;
    drivers.push("Low wording stability");
  }
  if (args.contradictions.some((c) => c.severity === "error")) {
    score += 0.15;
    drivers.push("Hard validation contradictions present");
  }
  if (args.historicalMatchCount === 0) {
    score += 0.08;
    drivers.push("No historical duration precedents — wrong identity invents a new cohort");
  }
  if (args.activityContributed === 0) {
    score += 0.05;
    drivers.push("No activity contribution — identity rests on name/WBS alone");
  }
  if (args.trust.state === "TRUSTED" && args.identity.status === "RESOLVED") {
    score = Math.max(0.05, score - 0.15);
    drivers.push("Auto-trusted complete identity reduces operational risk");
  }

  score = Math.max(0, Math.min(1, round2(score)));
  const risk: RiskAssessment["risk"] =
    score >= 0.75 ? "Critical" : score >= 0.55 ? "High" : score >= 0.35 ? "Medium" : "Low";

  return { risk, score, drivers };
}

export function buildKnowledgeCoverage(args: {
  decisions: Map<string, { fingerprint: string; status: string }>;
  fingerprint: string;
  nearestFingerprints: string[];
}): KnowledgeCoverage {
  const matched = args.nearestFingerprints.filter((fp) => args.decisions.has(fp));
  const exact = args.decisions.has(args.fingerprint) ? 1 : 0;
  const used = exact + matched.filter((fp) => fp !== args.fingerprint).length;
  // "Ignored" = stored knowledge entries that share no proximity — approximate via total - matched
  const totalStored = args.decisions.size;
  const ignored = Math.max(0, totalStored - matched.length - (exact && !matched.includes(args.fingerprint) ? 1 : 0));
  const matchedEntries = matched.length + (exact && !matched.includes(args.fingerprint) ? 1 : 0);
  const coverage = totalStored === 0 ? 0 : round2(matchedEntries / totalStored);

  return {
    matchedEntries,
    usedEntries: used,
    ignoredEntries: ignored,
    coverage,
    note:
      totalStored === 0
        ? "No developer Engineering Knowledge entries exist yet; coverage is observational only."
        : "matchedEntries ≈ fingerprints near this identity that have a stored decision; ignoredEntries are other stored decisions not nearby.",
  };
}

export function findNearestIdentities(args: {
  identity: EngineeringIdentity;
  fingerprint: string;
  subjectKey: string;
  peers: Array<{
    fingerprint: string;
    deliverableId: string | null;
    deliverableName: string;
    projectName: string;
    identity: EngineeringIdentity;
  }>;
  limit?: number;
}): NearestIdentity[] {
  const limit = args.limit ?? 5;
  if (args.identity.status !== "RESOLVED") return [];

  const scored = args.peers
    .filter((p) => p.fingerprint !== args.fingerprint)
    .map((p) => {
      const comparison = compareEngineeringIdentities(args.identity, p.identity);
      const identityMatches = comparison.matchedIdentityComponents.length;
      const identityTotal = 3;
      const descriptorMatches = comparison.checks.filter(
        (c) => c.role === "DESCRIPTOR" && c.result === "MATCH"
      ).length;
      const descriptorTotal = comparison.checks.filter((c) => c.role === "DESCRIPTOR").length || 1;
      const similarity = round2(
        (identityMatches / identityTotal) * 0.85 + (descriptorMatches / descriptorTotal) * 0.15
      );
      return {
        fingerprint: p.fingerprint,
        deliverableId: p.deliverableId,
        deliverableName: p.deliverableName,
        projectName: p.projectName,
        identityKey: identityKeyOf(p.identity),
        similarity,
        differingFields: fieldDiffs(args.identity, p.identity),
      };
    })
    .filter((p) => p.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity || a.deliverableName.localeCompare(b.deliverableName));

  return scored.slice(0, limit);
}

export function buildHumanSummary(args: {
  identity: EngineeringIdentity;
  trust: EngineeringTrustAssessment;
  confidenceBreakdown: ConfidenceBreakdown;
  missingEvidence: string[];
  contradictions: DiagnosticContradiction[];
  stability: StabilityAnalysis;
  historicalMatchCount: number;
}): string {
  const disc = args.identity.discipline.label ?? args.identity.discipline.id ?? "unresolved discipline";
  const obj = args.identity.engineeringObject.label ?? args.identity.engineeringObject.id ?? "unknown object";
  const work = args.identity.engineeringWork.label ?? args.identity.engineeringWork.id ?? "unknown work";

  const para1 =
    args.identity.status === "RESOLVED"
      ? `The deliverable was classified as ${disc} / ${obj} / ${work}.`
      : `The deliverable could not be fully resolved (status ${args.identity.status}); best partial reading is ${disc} / ${obj} / ${work}.`;

  const gains = args.confidenceBreakdown.steps.filter((s) => s.delta > 0).map((s) => s.source);
  const losses = args.confidenceBreakdown.steps.filter((s) => s.delta < 0).map((s) => s.source);
  let para2 = `Presentation confidence finished at ${Math.round(args.confidenceBreakdown.finalConfidence * 100)}%`;
  if (gains.length) para2 += `, lifted by ${gains.slice(0, 3).join(", ")}`;
  if (losses.length) para2 += `, reduced by ${losses.slice(0, 3).join(", ")}`;
  para2 += `. Trust state is ${args.trust.state}`;
  if (args.historicalMatchCount > 0) {
    para2 += ` with ${args.historicalMatchCount} equivalent historical match(es)`;
  } else {
    para2 += " with no equivalent historical matches";
  }
  para2 += `. Stability rating: ${args.stability.rating}.`;

  const investigate: string[] = [];
  if (args.contradictions.length) {
    investigate.push(args.contradictions[0]!.message);
  }
  if (args.missingEvidence.length) {
    investigate.push(`Investigate first: ${args.missingEvidence.slice(0, 3).join("; ")}.`);
  } else if (args.trust.state === "TRUSTED") {
    investigate.push("No material evidence gaps — identity is auto-trusted under current criteria.");
  }

  return [para1, para2, investigate.join(" ")].filter(Boolean).join("\n\n");
}

export function buildQualityWarnings(args: {
  identity: EngineeringIdentity;
  ruleTrace: RuleTrace[];
  confidenceBreakdown: ConfidenceBreakdown;
  activityContributed: number;
  historicalMatchCount: number;
  stability: StabilityAnalysis;
  contradictions: DiagnosticContradiction[];
}): string[] {
  const warnings: string[] = [];
  const sources = new Set(args.identity.supportingEvidence.map((e) => e.source));

  if (sources.size <= 1) warnings.push("Very few evidence sources.");
  if (args.identity.supportingEvidence.length < 2) warnings.push("Sparse supporting evidence.");

  const bonuses = args.ruleTrace.filter((r) => r.type === "bonus");
  if (bonuses.length === 1) warnings.push("Confidence driven by one rule.");

  if (args.activityContributed === 0) warnings.push("No activity evidence.");
  if (args.historicalMatchCount === 0) warnings.push("No historical duration evidence.");
  if (!args.identity.lifecycleStage.id) {
    warnings.push("Fingerprint created with missing lifecycle.");
  }
  if (!args.identity.engineeringObject.id) warnings.push("Engineering object unresolved.");
  if (args.stability.rating === "Low" || args.stability.rating === "Very Low") {
    warnings.push(`Identity stability is ${args.stability.rating}.`);
  }
  if (args.contradictions.some((c) => c.severity === "error")) {
    warnings.push("Hard contradictions present in the final identity.");
  }

  const largest = [...args.confidenceBreakdown.steps].sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta)
  )[0];
  if (largest && Math.abs(largest.delta) >= 0.2 && args.confidenceBreakdown.steps.length <= 3) {
    warnings.push(`Confidence dominated by “${largest.source}”.`);
  }

  return warnings;
}

export function validateExportRecord(record: Record<string, unknown>): ExportSelfValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const required = [
    "deliverableId",
    "name",
    "decision",
    "fingerprint",
    "fingerprintDetails",
    "currentIdentity",
    "pipeline",
    "confidenceBreakdown",
    "stability",
    "contradictions",
    "missingEvidence",
    "riskAssessment",
    "knowledgeCoverage",
    "nearestIdentities",
    "summary",
    "qualityWarnings",
    "replay",
  ];

  for (const key of required) {
    if (!(key in record) || record[key] === undefined) {
      errors.push(`Missing required field: ${key}`);
    }
  }

  const decision = record.decision as Record<string, unknown> | undefined;
  if (decision && typeof decision.trusted !== "boolean") {
    errors.push("decision.trusted must be boolean");
  }
  if (decision && typeof decision.fingerprint !== "string") {
    errors.push("decision.fingerprint must be string");
  }

  const pipeline = record.pipeline;
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    errors.push("pipeline must be a non-empty array");
  }

  if (record.deliverableId == null) {
    warnings.push("deliverableId is null — snapshot may lack a live deliverable link");
  }

  const confidenceBreakdown = record.confidenceBreakdown as { finalConfidence?: number } | undefined;
  if (
    confidenceBreakdown &&
    typeof confidenceBreakdown.finalConfidence === "number" &&
    (confidenceBreakdown.finalConfidence < 0 || confidenceBreakdown.finalConfidence > 1)
  ) {
    warnings.push("confidenceBreakdown.finalConfidence outside 0..1");
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function subjectKeyFromName(name: string): string {
  const doc = extractDocumentType(normaliseDeliverableNameForTaxonomy(name));
  return normaliseDeliverableNameForTaxonomy(doc?.residualSubject ?? name);
}

export { engineeringIdentityFingerprint };
