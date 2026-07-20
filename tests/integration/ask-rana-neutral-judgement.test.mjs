import test from "node:test";
import assert from "node:assert/strict";
import { buildAskRanaKnowledgePackage } from "../../dist/services/ask-rana/askRanaKnowledgePackage.service.js";
import { serializeKnowledgePackageForPrompt } from "../../dist/services/ask-rana/askRanaKnowledgeSerializer.js";
import { ASK_RANA_SYSTEM_PROMPT, buildAskRanaPrompt } from "../../dist/services/ask-rana/askRanaPrompt.builder.js";
import { interpretPlannerQuery } from "../../dist/services/ask-rana/askRanaPlannerQueryInterpreter.service.js";
import { verifyPlannerQuestion } from "../../dist/services/ask-rana/askRanaQuestionVerification.service.js";
import { buildPlannerInvestigation } from "../../dist/services/ask-rana/askRanaInvestigation.service.js";
import { classifyPlannerResponseDepth } from "../../dist/services/ask-rana/askRanaResponseDepth.service.js";

function mockPkg() {
  return {
    deliverable: { name: "Reinforcement Detailing", classification: "design", currentDurationDays: 5 },
    sources: ["projectEvolution", "programmeLogic"],
    evidenceGaps: [],
    projectEvolution: {
      available: true,
      revisionCount: 3,
      baselineDays: 10,
      latestDays: 5,
      netChangeDays: -5,
      summary: "Duration reduced from 10 to 5 days.",
      howChangedSummary: "Reduced at Update 1.",
      changePattern: "SUDDEN",
      volatility: "HIGH",
      timelineHighlights: [],
      revisionHighlights: [
        {
          label: "Update 1",
          role: "UPDATE",
          durationDays: 5,
          changeDays: -5,
          reason: "Duration reduced to 5 days.",
        },
      ],
      stablePeriods: [],
      revisions: [
        { label: "Baseline", role: "BASELINE", importedAt: "2024-01-01", durationDays: 10, durationChangeDays: null },
        { label: "Update 1", role: "UPDATE", importedAt: "2024-01-15", durationDays: 5, durationChangeDays: -5 },
        { label: "Update 2", role: "UPDATE", importedAt: "2024-02-01", durationDays: 5, durationChangeDays: 0 },
      ],
      plannerObservations: [],
      showFullTimeline: false,
    },
    programmeLogic: {
      available: true,
      summary: "Float increased at Update 1.",
      revisions: [
        {
          label: "Update 1",
          relationshipCount: 3,
          relationshipCountChange: 1,
          events: [
            { type: "FLOAT_GAINED", activityCode: "A1", description: "Total float increased from 12 to 73 days." },
            { type: "RELATIONSHIP_ADDED", activityCode: "A1", description: "A new Finish-to-Finish (FF) relationship was introduced." },
          ],
          plannerObservations: [],
        },
      ],
    },
    previousProjects: { available: false },
  };
}

function buildKnowledge(question, pkg, conversation) {
  const plannerQuery = interpretPlannerQuery(question);
  const responseDepth = classifyPlannerResponseDepth({ question, plannerQuery, conversation });
  const verification = verifyPlannerQuestion({
    question,
    evidencePackage: pkg,
    plannerQuery,
    conversation,
    responseDepth: responseDepth.depth,
  });
  const investigation = buildPlannerInvestigation({
    question,
    evidencePackage: pkg,
    plannerQuery,
    conversation,
    depth: responseDepth.depth,
  });
  return buildAskRanaKnowledgePackage({
    evidencePackage: pkg,
    plannerQuery,
    verification,
    responseDepth,
    investigation,
    question,
  });
}

test("system prompt carries only the three grounding principles for judgement", () => {
  assert.ok(ASK_RANA_SYSTEM_PROMPT.includes("Never invent facts."));
  assert.ok(ASK_RANA_SYSTEM_PROMPT.includes("Never claim certainty beyond the evidence."));
  assert.ok(ASK_RANA_SYSTEM_PROMPT.includes("Clearly distinguish observations from interpretations."));

  assert.ok(!ASK_RANA_SYSTEM_PROMPT.includes("Biggest change ≠ biggest risk"));
  assert.ok(!ASK_RANA_SYSTEM_PROMPT.includes("review first"));
  assert.ok(!ASK_RANA_SYSTEM_PROMPT.includes("Sudden change alone is not a concern"));
});

test("system prompt tells the LLM to evaluate planner opinions, not adopt them", () => {
  assert.ok(ASK_RANA_SYSTEM_PROMPT.includes("treat it as a hypothesis"));
  assert.ok(ASK_RANA_SYSTEM_PROMPT.includes("supports it, contradicts it, or is insufficient"));
  assert.ok(ASK_RANA_SYSTEM_PROMPT.includes("what changed, not whether decisions were appropriate"));
});

test("risk questions no longer receive judgement-steering sections", () => {
  const knowledge = buildKnowledge("Which revision was the riskiest?", mockPkg());
  const serialized = serializeKnowledgePackageForPrompt(knowledge);

  assert.equal(knowledge.judgementGuidance, undefined);
  assert.equal(knowledge.judgementEvidenceNotes, undefined);
  assert.ok(!serialized.includes("Planner judgement guidance"));
  assert.ok(!serialized.includes("Risk and change evidence"));
  assert.ok(!knowledge.conversationContext.plannerExpectation.includes("separate change magnitude from risk"));
});

test("opinion follow-up keeps knowledge package factual with unknowns intact", () => {
  const conversation = [
    { role: "planner", content: "What changed in Update 1?" },
    { role: "rana", content: "Update 1 reduced the duration from 10 to 5 days and float increased from 12 to 73 days." },
  ];
  const knowledge = buildKnowledge(
    "I disagree. I think Update 1 was a bad planning decision.",
    mockPkg(),
    conversation
  );
  const prompt = buildAskRanaPrompt({
    question: "I disagree. I think Update 1 was a bad planning decision.",
    knowledge,
    conversation,
  });

  assert.ok(knowledge.confirmedFacts.length > 0);
  assert.ok(knowledge.unknowns.length > 0);
  assert.ok(!prompt.user.includes("Planner judgement guidance"));
  assert.ok(prompt.system.includes("treat it as a hypothesis"));
});
