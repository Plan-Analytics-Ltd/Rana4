import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_STORED_REASONING_FIELDS,
  storedReasoningFieldsFromResult,
} from "../../dist/services/intelligence/taxonomy/engineeringReasoningOrchestration.service.js";

function reasonedResult(overrides = {}) {
  return {
    status: "RESOLVED",
    discipline: { id: "structural", label: "Structural", evidence: [] },
    engineeringObject: { id: "reinforcement", label: "Reinforcement", evidence: [] },
    engineeringWork: { id: "detailing", label: "Detailing", evidence: [] },
    deliverableType: { id: "drawing", label: "Drawing", evidence: [] },
    lifecycleStage: { id: "design", label: "Design", evidence: [] },
    projectContext: { id: null, label: null, evidence: [] },
    fragnetContext: { id: null, label: null, evidence: [] },
    taxonomy: {
      taxonomyKey: null,
      categoryId: null,
      workPackageId: null,
      isUnknownWorkPackage: false,
    },
    supportingEvidence: [],
    confidence: "HIGH",
    reasoning: "test",
    source: "LLM_REASONED",
    overrides: [],
    validation: { valid: true, contradictions: [] },
    ...overrides,
  };
}

test("storedReasoningFieldsFromResult stores LLM_REASONED results", () => {
  const at = new Date("2026-07-17T10:00:00.000Z");
  const fields = storedReasoningFieldsFromResult(reasonedResult(), at);
  assert.equal(fields.reasonedDiscipline, "structural");
  assert.equal(fields.reasonedEngineeringObject, "reinforcement");
  assert.equal(fields.reasonedEngineeringWork, "detailing");
  assert.equal(fields.reasonedDeliverableType, "drawing");
  assert.equal(fields.reasonedLifecycleStage, "design");
  assert.equal(fields.reasoningSource, "LLM_REASONED");
  assert.equal(fields.reasoningComputedAt?.toISOString(), at.toISOString());
});

test("storedReasoningFieldsFromResult stores LLM_MERGED results", () => {
  const fields = storedReasoningFieldsFromResult(reasonedResult({ source: "LLM_MERGED" }));
  assert.equal(fields.reasoningSource, "LLM_MERGED");
  assert.equal(fields.reasonedDiscipline, "structural");
});

test("storedReasoningFieldsFromResult leaves RULE_BASED as null (kill-switch / fallback)", () => {
  const fields = storedReasoningFieldsFromResult(reasonedResult({ source: "RULE_BASED" }));
  assert.deepEqual(fields, EMPTY_STORED_REASONING_FIELDS);
});

test("storedReasoningFieldsFromResult leaves undefined as null", () => {
  assert.deepEqual(storedReasoningFieldsFromResult(undefined), EMPTY_STORED_REASONING_FIELDS);
});
