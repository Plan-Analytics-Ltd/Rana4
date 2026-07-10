import test from "node:test";
import assert from "node:assert/strict";
import { buildAskRanaKnowledgePackage } from "../../dist/services/ask-rana/askRanaKnowledgePackage.service.js";
import { serializeKnowledgePackageForPrompt } from "../../dist/services/ask-rana/askRanaKnowledgeSerializer.js";
import { buildAskRanaPrompt } from "../../dist/services/ask-rana/askRanaPrompt.builder.js";
import { interpretPlannerQuery } from "../../dist/services/ask-rana/askRanaPlannerQueryInterpreter.service.js";
import { verifyPlannerQuestion } from "../../dist/services/ask-rana/askRanaQuestionVerification.service.js";
import { buildPlannerInvestigation } from "../../dist/services/ask-rana/askRanaInvestigation.service.js";
import { classifyPlannerResponseDepth } from "../../dist/services/ask-rana/askRanaResponseDepth.service.js";

function mockPkg(overrides = {}) {
  return {
    deliverable: { name: "Detailed Design", classification: "design", currentDurationDays: 5 },
    sources: ["projectEvolution", "programmeLogic"],
    evidenceGaps: [],
    projectEvolution: {
      available: true,
      baselineDays: 10,
      latestDays: 5,
      netChangeDays: -5,
      summary: "Duration reduced from 10 to 5 days.",
      howChangedSummary: "Reduced over several programme updates.",
      timelineHighlights: [],
      revisionHighlights: [],
      stablePeriods: [],
      revisions: [],
      plannerObservations: [],
      showFullTimeline: false,
    },
    programmeLogic: {
      available: true,
      summary: "Float reduced before criticality.",
      revisions: [],
    },
    previousProjects: { available: false },
    ...overrides,
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
    followUpIntent: responseDepth.followUpIntent,
  });
  return buildAskRanaKnowledgePackage({
    evidencePackage: pkg,
    plannerQuery,
    verification,
    responseDepth,
    investigation,
  });
}

test("knowledge package separates facts, conclusions, and unknowns", () => {
  const pkg = mockPkg();
  const knowledge = buildKnowledge("Why did the float reduce?", pkg);

  assert.ok(knowledge.confirmedFacts.length > 0);
  assert.ok(knowledge.plannerContext.intent.length > 0);
  assert.ok(knowledge.unknowns.length > 0);
  assert.ok(knowledge.conversationContext.plannerExpectation.length > 0);
});

test("investigation findings flow into knowledge package", () => {
  const pkg = mockPkg({
    projectEvolution: {
      available: true,
      baselineDays: 5,
      latestDays: 5,
      netChangeDays: 0,
      summary: "Duration stable at 5 days.",
      howChangedSummary: "Duration unchanged across updates.",
      timelineHighlights: [],
      revisionHighlights: [],
      stablePeriods: [
        { startLabel: "Update 2", endLabel: "As-built", durationDays: 5, revisionCount: 11 },
      ],
      revisions: [],
      plannerObservations: [],
      showFullTimeline: false,
    },
    programmeLogic: {
      available: true,
      summary: "Float reduced across updates.",
      revisions: [
        {
          label: "Update 2",
          relationshipCount: 2,
          relationshipCountChange: 0,
          events: [{ type: "FLOAT_LOST", activityCode: "A1", description: "Lost flexibility." }],
          plannerObservations: ["Duration was unchanged in this revision."],
        },
        {
          label: "Update 3",
          relationshipCount: 2,
          relationshipCountChange: 0,
          events: [{ type: "FLOAT_LOST", activityCode: "A1", description: "Lost more flexibility." }],
          plannerObservations: [],
        },
      ],
    },
  });
  const knowledge = buildKnowledge("Investigate why the float reduced.", pkg);

  assert.ok(knowledge.investigationFindings);
  assert.ok(knowledge.ruledOutExplanations.some((r) => /duration/i.test(r)));
  assert.ok(knowledge.supportedConclusions.length > 0);
});

test("factual corrections appear in serialized knowledge", () => {
  const pkg = mockPkg();
  const knowledge = buildKnowledge("Why was it increased from 10 to 20 days?", pkg);
  const serialized = serializeKnowledgePackageForPrompt(knowledge);

  assert.ok(knowledge.factualCorrections.length > 0);
  assert.ok(serialized.includes("Factual corrections"));
  assert.ok(serialized.includes("Confirmed facts"));
});

test("partial evidence note when comparison unavailable but evolution exists", () => {
  const pkg = mockPkg();
  const knowledge = buildKnowledge("Is this duration reasonable?", pkg);

  assert.ok(knowledge.evidenceNotes.some((n) => /partial evidence/i.test(n)));
});

test("prompt uses knowledge package not instruction blocks", () => {
  const pkg = mockPkg();
  const question = "Why did the float reduce?";
  const knowledge = buildKnowledge(question, pkg);
  const prompt = buildAskRanaPrompt({ question, knowledge });

  assert.ok(prompt.user.includes("Knowledge package"));
  assert.ok(prompt.user.includes("Planner expectation"));
  assert.ok(!prompt.user.includes("INVESTIGATION MODE"));
  assert.ok(!prompt.user.includes("Response depth:"));
  assert.ok(prompt.system.includes("knowledge package"));
});
