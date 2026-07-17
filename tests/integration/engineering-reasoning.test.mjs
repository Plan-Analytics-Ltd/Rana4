import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveEngineeringIdentity,
} from "../../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import {
  validateEngineeringIdentity,
  enforceEngineeringIdentityValidation,
} from "../../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import {
  parseEngineeringReasoning,
  mergeReasonedIdentity,
  reasonEngineeringIdentity,
  explainEngineeringComparison,
  getEngineeringReasoningConfig,
} from "../../dist/services/intelligence/taxonomy/engineeringReasoning.service.js";

function identity(name, fragnetName = null, extra = {}) {
  return resolveEngineeringIdentity({ deliverableName: name, fragnetName, ...extra });
}

test("validation accepts a consistent rule-based identity", () => {
  const resolved = identity("Reinforcement Detailing", "Structures");
  const validation = validateEngineeringIdentity(resolved);
  assert.equal(validation.valid, true, JSON.stringify(validation.contradictions));
});

test("validation rejects a document type used as an engineering object", () => {
  const bad = {
    ...identity("Reinforcement Detailing", "Structures"),
    engineeringObject: { id: "report", label: "Report", evidence: [] },
  };
  const validation = validateEngineeringIdentity(bad);
  assert.equal(validation.valid, false);
  assert.ok(validation.contradictions.some((c) => c.rule === "OBJECT_MUST_BE_PHYSICAL"));
});

test("validation rejects an object incompatible with the discipline", () => {
  const bad = {
    ...identity("Fire Technical Note", "Fire Engineering"),
    discipline: { id: "mechanical", label: "Mechanical", evidence: [] },
    engineeringObject: { id: "fire_safety", label: "Fire Safety", evidence: [] },
  };
  const validation = validateEngineeringIdentity(bad);
  assert.equal(validation.valid, false);
  assert.ok(validation.contradictions.some((c) => c.rule === "OBJECT_DISCIPLINE_INCOMPATIBLE"));
});

test("enforcement fails closed: contradictory identity becomes INSUFFICIENT and cannot match", () => {
  const bad = {
    ...identity("Fire Technical Note", "Fire Engineering"),
    discipline: { id: "mechanical", label: "Mechanical", evidence: [] },
    engineeringObject: { id: "fire_safety", label: "Fire Safety", evidence: [] },
  };
  const enforced = enforceEngineeringIdentityValidation(bad);
  assert.equal(enforced.status, "INSUFFICIENT");
  assert.equal(enforced.discipline.id, null);
  assert.equal(enforced.engineeringObject.id, null);

  const clean = identity("Fire Technical Note", "Fire Engineering");
  const comparison = explainEngineeringComparison(enforced, clean);
  assert.equal(comparison.equivalent, false);
});

test("parses strict JSON reasoning output", () => {
  const parsed = parseEngineeringReasoning(
    'Here is my answer: {"discipline":"structural","engineeringObject":"foundations","engineeringWork":"detailing","deliverableType":"drawing","lifecycleStage":null,"confidence":"HIGH","reasoning":"WBS sits under substructure","rejectedAlternatives":"not steelwork","keyEvidence":"pile caps activities"}'
  );
  assert.equal(parsed.discipline, "structural");
  assert.equal(parsed.engineeringObject, "foundations");
  assert.equal(parsed.confidence, "HIGH");
  assert.match(parsed.reasoning, /substructure/);
});

test("returns null on non-JSON / UNKNOWN reasoning output", () => {
  assert.equal(parseEngineeringReasoning("I cannot determine this."), null);
  const unknown = parseEngineeringReasoning('{"engineeringObject":"unknown","confidence":"UNKNOWN"}');
  assert.equal(unknown.engineeringObject, null);
  assert.equal(unknown.confidence, "UNKNOWN");
});

test("merge lets reasoning override the taxonomy baseline with a valid object", () => {
  const baseline = identity("Substructure Works Package", "Enabling Works");
  const parsed = parseEngineeringReasoning(
    '{"discipline":"structural","engineeringObject":"foundations","engineeringWork":"design","deliverableType":"drawing","confidence":"HIGH","reasoning":"foundations"}'
  );
  const merged = mergeReasonedIdentity(baseline, parsed);
  assert.equal(merged.identity.engineeringObject.id, "foundations");
  assert.equal(merged.identity.engineeringWork.id, "design");
});

test("merge ignores an invented object id and keeps the baseline", () => {
  const baseline = identity("Reinforcement Detailing", "Structures");
  const parsed = parseEngineeringReasoning(
    '{"engineeringObject":"unicorn_asset","confidence":"LOW","reasoning":"guess"}'
  );
  const merged = mergeReasonedIdentity(baseline, parsed);
  assert.equal(merged.identity.engineeringObject.id, baseline.engineeringObject.id);
});

test("reasoning is disabled by default and falls back to the validated rule-based identity", async () => {
  const config = getEngineeringReasoningConfig();
  assert.equal(config.enabled, false);

  const context = {
    deliverableName: "Reinforcement Detailing",
    fragnetName: "Structures",
    parentWbs: null,
    wbsPath: null,
    activityNames: ["Produce reinforcement detailing"],
    neighbours: [],
    projectType: "Healthcare",
    sector: null,
    client: null,
    stage: "Stage 3",
    disciplineTag: null,
    activityCodeDiscipline: null,
    classificationTags: null,
    taxonomy: {
      disciplineId: "structural",
      disciplineLabel: "Structural",
      workPackageId: "reinforcement_detailing",
      workPackageLabel: "Reinforcement Detailing",
      matched: true,
      isUnknownWorkPackage: false,
    },
    aliases: [],
    vocabulary: [],
  };

  const result = await reasonEngineeringIdentity(context);
  assert.equal(result.source, "RULE_BASED");
  const ruleBased = identity("Reinforcement Detailing", "Structures", {
    lifecycleStage: "Stage 3",
    projectContext: { projectType: "Healthcare" },
    relatedActivityNames: ["Produce reinforcement detailing"],
  });
  assert.equal(result.engineeringObject.id, ruleBased.engineeringObject.id);
  assert.equal(result.discipline.id, ruleBased.discipline.id);
  assert.ok(result.validation.valid);
});

test("explainable comparison records matched components and evidence", () => {
  const target = identity("Reinforcement Detailing", "Structures");
  const candidate = identity("Produce Reinforcement Detailing", "Foundations");
  const explanation = explainEngineeringComparison(target, candidate);
  assert.equal(explanation.equivalent, true);
  assert.ok(explanation.matched.some((m) => m.component === "ENGINEERING_OBJECT"));
  assert.ok(explanation.matched.every((m) => Array.isArray(m.evidence)));
});

test("explainable comparison records the rejecting component", () => {
  const target = identity("Mechanical Technical Note", "Mechanical");
  const candidate = identity("Fire Technical Note", "Fire Engineering");
  const explanation = explainEngineeringComparison(target, candidate);
  assert.equal(explanation.equivalent, false);
  assert.ok(explanation.rejected.some((r) => r.component === "DISCIPLINE"));
});
