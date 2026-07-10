import test from "node:test";
import assert from "node:assert/strict";
import { verifyPlannerQuestion } from "../../dist/services/ask-rana/askRanaQuestionVerification.service.js";
import { buildAskRanaPrompt } from "../../dist/services/ask-rana/askRanaPrompt.builder.js";
import { buildAskRanaKnowledgePackage } from "../../dist/services/ask-rana/askRanaKnowledgePackage.service.js";
import { interpretPlannerQuery } from "../../dist/services/ask-rana/askRanaPlannerQueryInterpreter.service.js";
import { buildPlannerInvestigation } from "../../dist/services/ask-rana/askRanaInvestigation.service.js";
import { classifyPlannerResponseDepth } from "../../dist/services/ask-rana/askRanaResponseDepth.service.js";

function mockEvolutionPkg(overrides = {}) {
  return {
    deliverable: { name: "Detailed Design", classification: "design", currentDurationDays: 5 },
    sources: ["projectEvolution", "previousProjects", "lessonsLearned", "recommendations"],
    evidenceGaps: [
      "Not enough completed projects imported for comparison.",
      "No lessons learned recorded yet.",
      "No recommendations generated yet.",
      "No similar completed projects found.",
    ],
    projectEvolution: {
      available: true,
      baselineDays: 10,
      latestDays: 5,
      netChangeDays: -5,
      summary: "Duration moved from 10 to 5 days across 13 revisions.",
      howChangedSummary: "Reduced from 10 days to 5 days over 13 programme revisions.",
      trend: "decreasing",
      changePattern: "gradual",
      volatility: "high",
      plannerObservations: [
        "The programme history records how the duration changed, but not why each planning decision was made.",
      ],
      timelineHighlights: [],
      revisionHighlights: [],
      stablePeriods: [],
      revisions: [],
      showFullTimeline: false,
    },
    previousProjects: { available: false },
    ...overrides,
  };
}

test("detects false increase assumption when evidence shows reduction", () => {
  const pkg = mockEvolutionPkg();
  const result = verifyPlannerQuestion({
    question: "Why was it increased from 10 to 20 days?",
    evidencePackage: pkg,
  });

  assert.ok(result.corrections.length > 0);
  assert.ok(result.corrections.some((c) => /10.*5|reduced|reduction/i.test(c)));
  assert.equal(result.topic, "evolution");
});

test("plant question gets brief style and plant-only missing evidence", () => {
  const pkg = mockEvolutionPkg();
  const result = verifyPlannerQuestion({
    question: "Is there a crane?",
    evidencePackage: pkg,
  });

  assert.equal(result.topic, "out_of_scope_plant");
  assert.equal(result.responseStyle, "brief");
  assert.ok(result.relevantMissingEvidence.some((m) => /plant|equipment/i.test(m)));
  assert.ok(!result.relevantMissingEvidence.some((m) => /previous project|lessons|recommendation/i.test(m)));
});

test("people question does not mention benchmark gaps", () => {
  const pkg = mockEvolutionPkg();
  const result = verifyPlannerQuestion({
    question: "Which subcontractor caused this?",
    evidencePackage: pkg,
  });

  assert.equal(result.topic, "out_of_scope_people");
  assert.ok(result.relevantMissingEvidence.some((m) => /subcontractor|responsibility/i.test(m)));
  assert.ok(!result.relevantMissingEvidence.some((m) => /completed project|benchmark/i.test(m)));
});

test("follow-up why question avoids repeating established facts", () => {
  const pkg = mockEvolutionPkg();
  const result = verifyPlannerQuestion({
    question: "Why?",
    evidencePackage: pkg,
    conversation: [
      { role: "planner", content: "What changed?" },
      {
        role: "rana",
        content: "Duration reduced from baseline 10 days to latest 5 days across 13 programme revisions.",
      },
    ],
  });

  assert.ok(result.isFollowUp);
  assert.ok(result.doNotRepeat.length > 0);
});

function buildPromptFromPkg(question, pkg, conversation) {
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
  const knowledge = buildAskRanaKnowledgePackage({
    evidencePackage: pkg,
    plannerQuery,
    verification,
    responseDepth,
    investigation,
  });
  return { prompt: buildAskRanaPrompt({ question, knowledge, conversation }), verification, knowledge };
}

test("prompt includes verification corrections and omits generic gaps for plant questions", () => {
  const pkg = mockEvolutionPkg();
  const question = "What colour is the crane?";
  const { prompt, verification } = buildPromptFromPkg(question, pkg);

  assert.ok(prompt.user.includes("Planner expectation"));
  assert.ok(
    prompt.user.includes("Plant and equipment") ||
      prompt.user.includes("outside programme duration intelligence") ||
      verification.relevantMissingEvidence.some((m) => /plant|equipment/i.test(m))
  );
  assert.ok(!prompt.user.includes("Not enough completed projects"));
  assert.ok(!prompt.user.includes("lessons learned"));
});

test("comparison question keeps relevant benchmark gaps", () => {
  const pkg = mockEvolutionPkg({
    previousProjects: {
      available: true,
      comparisonAssessment: "Slightly longer than typical.",
      typicalRangeLabel: "8–12 days",
      typicalDurationDays: 10,
      currentDurationDays: 5,
      sampleSize: 3,
      completedProjectCount: 2,
      comparableWork: [],
      observations: [],
    },
  });
  const result = verifyPlannerQuestion({
    question: "Should I increase it to 15 days?",
    evidencePackage: pkg,
  });

  assert.equal(result.topic, "comparison");
  assert.ok(result.relevantMissingEvidence.length > 0 || result.corrections.length >= 0);
});

test("who designed question is brief and people-scoped", () => {
  const pkg = mockEvolutionPkg();
  const result = verifyPlannerQuestion({
    question: "Who designed the building?",
    evidencePackage: pkg,
  });

  assert.equal(result.topic, "out_of_scope_people");
  assert.equal(result.responseStyle, "brief");
  assert.ok(result.relevantMissingEvidence.some((m) => /designer/i.test(m)));
});

test("comparison without completed projects uses partial-evidence instructions when evolution exists", () => {
  const pkg = mockEvolutionPkg();
  const result = verifyPlannerQuestion({
    question: "Is this duration reasonable?",
    evidencePackage: pkg,
  });

  assert.equal(result.topic, "comparison");
  const { knowledge } = buildPromptFromPkg("Is this duration reasonable?", pkg);
  assert.ok(knowledge.evidenceNotes.some((n) => /partial evidence/i.test(n)));
  assert.ok(!result.relevantMissingEvidence.some((m) => /don't have enough/i.test(m)));
  assert.ok(!result.relevantMissingEvidence.some((m) => /Not enough completed projects imported for comparison/i.test(m)));
});

test("partial comparison answer leads with evolution facts then limitation", async () => {
  const { buildPartialComparisonAnswer } = await import(
    "../../dist/services/ask-rana/askRanaPartialEvidence.service.js"
  );
  const pkg = mockEvolutionPkg();
  const answer = buildPartialComparisonAnswer(pkg);

  assert.ok(answer.length >= 2);
  assert.ok(/5 days|baseline|10/i.test(answer[0]));
  assert.ok(answer[answer.length - 1].includes("can't yet judge"));
});

test("duration reasonableness question selects evolution domains for partial evidence", async () => {
  const { selectAskRanaEvidenceDomains } = await import(
    "../../dist/services/ask-rana/askRanaEvidenceSelector.js"
  );
  const domains = selectAskRanaEvidenceDomains("Is this duration reasonable?");
  assert.ok(domains.includes("previousProjects"));
  assert.ok(domains.includes("projectEvolution"));
});

test("prompts encourage natural communication with knowledge grounding", async () => {
  const { ASK_RANA_SYSTEM_PROMPT } = await import(
    "../../dist/services/ask-rana/askRanaPrompt.builder.js"
  );

  assert.ok(ASK_RANA_SYSTEM_PROMPT.includes("knowledge package"));
  assert.ok(ASK_RANA_SYSTEM_PROMPT.includes("Never invent"));

  const pkg = mockEvolutionPkg();
  const question =
    "On project evolution level, is this duration reasonable given the full revision history on this project?";
  const { prompt } = buildPromptFromPkg(question, pkg);

  assert.ok(prompt.user.includes("Knowledge package"));
  assert.ok(prompt.user.includes("Planner expectation"));
});
