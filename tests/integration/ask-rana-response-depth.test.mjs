import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPlannerResponseDepth,
  detectFollowUpIntent,
  extractExplainedTopics,
  hasDetailedPriorAnswer,
} from "../../dist/services/ask-rana/askRanaResponseDepth.service.js";
import { interpretPlannerQuery } from "../../dist/services/ask-rana/askRanaPlannerQueryInterpreter.service.js";
import { buildPlannerInvestigation } from "../../dist/services/ask-rana/askRanaInvestigation.service.js";
import { buildAskRanaPrompt } from "../../dist/services/ask-rana/askRanaPrompt.builder.js";
import { buildAskRanaKnowledgePackage } from "../../dist/services/ask-rana/askRanaKnowledgePackage.service.js";
import { verifyPlannerQuestion } from "../../dist/services/ask-rana/askRanaQuestionVerification.service.js";

function longFloatAnswer() {
  return `### Summary

The activity progressively lost scheduling flexibility across Updates 2 through 5 before becoming critical.

### Reasoning

Duration remained unchanged at 5 days throughout. The float reduction coincided with relationship tightening recorded at Update 4.

### Evidence

- Update 2: scheduling flexibility reduced
- Update 3: further float loss
- Update 5: became critical`;
}

test("classifies depth from question type and conversation state", () => {
  assert.equal(
    classifyPlannerResponseDepth({
      question: "Which update?",
      plannerQuery: interpretPlannerQuery("Which update?"),
    }).depth,
    "ONE_LINE"
  );

  assert.equal(
    classifyPlannerResponseDepth({
      question: "Investigate why the float reduced.",
      plannerQuery: interpretPlannerQuery("Investigate why the float reduced."),
    }).depth,
    "INVESTIGATION"
  );

  assert.equal(
    classifyPlannerResponseDepth({
      question: "Summarise everything about this deliverable.",
      plannerQuery: interpretPlannerQuery("Summarise everything about this deliverable."),
    }).depth,
    "REPORT"
  );
});

test("follow-up compression after detailed answer", () => {
  const conversation = [
    { role: "planner", content: "Why did the float reduce?" },
    { role: "rana", content: longFloatAnswer() },
  ];

  assert.ok(hasDetailedPriorAnswer(conversation));

  const howKnow = classifyPlannerResponseDepth({
    question: "How do you know?",
    plannerQuery: interpretPlannerQuery("How do you know?"),
    conversation,
  });
  assert.equal(howKnow.depth, "BRIEF");
  assert.equal(howKnow.followUpIntent, "challenge");
  assert.ok(howKnow.plannerExpectation.includes("brief"));
  assert.ok(howKnow.plannerExpectation.includes("how you know"));

  const evidence = classifyPlannerResponseDepth({
    question: "What evidence supports that?",
    plannerQuery: interpretPlannerQuery("What evidence supports that?"),
    conversation,
  });
  assert.equal(evidence.depth, "STANDARD");
  assert.equal(evidence.followUpIntent, "evidence_only");
  assert.ok(evidence.plannerExpectation.includes("supporting evidence"));

  const alternatives = classifyPlannerResponseDepth({
    question: "Could there be another explanation?",
    plannerQuery: interpretPlannerQuery("Could there be another explanation?"),
    conversation,
  });
  assert.equal(alternatives.followUpIntent, "alternatives");
  assert.ok(alternatives.plannerExpectation.includes("alternative explanations"));

  const rulingOut = classifyPlannerResponseDepth({
    question: "What evidence rules that out?",
    plannerQuery: interpretPlannerQuery("What evidence rules that out?"),
    conversation,
  });
  assert.equal(rulingOut.followUpIntent, "ruling_out");
  assert.ok(rulingOut.plannerExpectation.includes("rules out"));
});

test("tracks topics already explained in conversation", () => {
  const topics = extractExplainedTopics([
    { role: "planner", content: "Why?" },
    { role: "rana", content: longFloatAnswer() },
  ]);

  assert.ok(topics.some((t) => /float/i.test(t)));
  assert.ok(topics.some((t) => /duration/i.test(t)));
  assert.ok(topics.some((t) => /critical/i.test(t)));
});

test("challenge questions are not treated as investigation restart", () => {
  const pkg = {
    deliverable: { name: "Test", classification: null, currentDurationDays: 5 },
    sources: ["programmeLogic"],
    evidenceGaps: [],
    programmeLogic: { available: true, summary: "Float reduced.", revisions: [] },
  };

  const conversation = [
    { role: "planner", content: "Why did the float reduce?" },
    { role: "rana", content: longFloatAnswer() },
  ];

  const depth = classifyPlannerResponseDepth({
    question: "How do you know?",
    plannerQuery: interpretPlannerQuery("How do you know?"),
    conversation,
  });

  const investigation = buildPlannerInvestigation({
    question: "How do you know?",
    evidencePackage: pkg,
    plannerQuery: interpretPlannerQuery("How do you know?"),
    conversation,
    depth: depth.depth,
    followUpIntent: depth.followUpIntent,
  });

  assert.equal(investigation.mode, "none");
  assert.equal(investigation.findings, null);
});

test("prompt includes planner expectation and suppresses investigation on brief follow-up", () => {
  const pkg = {
    deliverable: { name: "Test", classification: null, currentDurationDays: 5 },
    sources: ["projectEvolution", "programmeLogic"],
    evidenceGaps: [],
    projectEvolution: {
      available: true,
      baselineDays: 5,
      latestDays: 5,
      netChangeDays: 0,
      timelineHighlights: [],
      plannerObservations: [],
      revisionHighlights: [],
      stablePeriods: [],
      revisions: [],
      showFullTimeline: false,
    },
    programmeLogic: { available: true, summary: "Float reduced.", revisions: [] },
  };

  const conversation = [
    { role: "planner", content: "Why did the float reduce?" },
    { role: "rana", content: longFloatAnswer() },
  ];

  const question = "How do you know?";
  const plannerQuery = interpretPlannerQuery(question);
  const responseDepth = classifyPlannerResponseDepth({
    question,
    plannerQuery,
    conversation,
  });
  const verification = verifyPlannerQuestion({
    question,
    evidencePackage: pkg,
    conversation,
    plannerQuery,
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
  const prompt = buildAskRanaPrompt({ question, knowledge, conversation });

  assert.ok(prompt.user.includes("Planner expectation"));
  assert.ok(prompt.user.includes("brief"));
  assert.ok(!prompt.user.includes("INVESTIGATION MODE"));
  assert.equal(detectFollowUpIntent("Really?"), "challenge");
});

test("first-turn why float question still gets investigation depth", () => {
  const depth = classifyPlannerResponseDepth({
    question: "Why did the float reduce?",
    plannerQuery: interpretPlannerQuery("Why did the float reduce?"),
  });

  assert.equal(depth.depth, "INVESTIGATION");
});
