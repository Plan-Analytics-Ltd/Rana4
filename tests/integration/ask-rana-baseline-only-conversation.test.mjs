import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBaselineOnlyConversationAnswer,
  isBaselineOnlyConversationState,
  isBaselineOnlyProgramme,
  isChangeOrRevisionQuestion,
  humanizeBaselineOnlyGap,
} from "../../dist/services/ask-rana/askRanaBaselineOnlyConversation.service.js";
import { verifyPlannerQuestion } from "../../dist/services/ask-rana/askRanaQuestionVerification.service.js";
import { buildAskRanaKnowledgePackage } from "../../dist/services/ask-rana/askRanaKnowledgePackage.service.js";
import { interpretPlannerQuery } from "../../dist/services/ask-rana/askRanaPlannerQueryInterpreter.service.js";
import { classifyPlannerResponseDepth } from "../../dist/services/ask-rana/askRanaResponseDepth.service.js";
import { buildPlannerInvestigation } from "../../dist/services/ask-rana/askRanaInvestigation.service.js";
import { buildEvolutionFactsForAnswer } from "../../dist/services/ask-rana/askRanaPartialEvidence.service.js";

function baselineOnlyPkg(overrides = {}) {
  return {
    deliverable: { name: "Foundation Works", classification: "construction", currentDurationDays: 20 },
    sources: ["projectEvolution", "programmeLogic"],
    evidenceGaps: [],
    projectEvolution: {
      available: true,
      revisionCount: 1,
      baselineOnly: true,
      baselineDays: 20,
      latestDays: 20,
      netChangeDays: 0,
      summary: null,
      howChangedSummary: null,
      trend: null,
      changePattern: null,
      volatility: null,
      timelineHighlights: [],
      revisionHighlights: [],
      stablePeriods: [],
      revisions: [{ label: "Baseline", role: "Baseline", importedAt: "2026-01-01", durationDays: 20, durationChangeDays: null }],
      plannerObservations: [],
      showFullTimeline: false,
    },
    programmeLogic: null,
    previousProjects: { available: false },
    ...overrides,
  };
}

function awaitingUpdatePkg() {
  return {
    deliverable: { name: "Foundation Works", classification: "construction", currentDurationDays: 20 },
    sources: ["projectEvolution"],
    evidenceGaps: ["No revision history on this project yet."],
    projectEvolution: null,
    previousProjects: { available: false },
  };
}

function buildKnowledge(question, pkg) {
  const plannerQuery = interpretPlannerQuery(question);
  const responseDepth = classifyPlannerResponseDepth({ question, plannerQuery, conversation: [] });
  const verification = verifyPlannerQuestion({
    question,
    evidencePackage: pkg,
    plannerQuery,
    responseDepth: responseDepth.depth,
  });
  const investigation = buildPlannerInvestigation({
    question,
    evidencePackage: pkg,
    plannerQuery,
    depth: responseDepth.depth,
    followUpIntent: responseDepth.followUpIntent,
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

test("detects change and revision questions", () => {
  assert.ok(isChangeOrRevisionQuestion("What changed?"));
  assert.ok(isChangeOrRevisionQuestion("Why did this change?"));
  assert.ok(isChangeOrRevisionQuestion("What changed in the logic?"));
  assert.ok(isChangeOrRevisionQuestion("Has anything changed?"));
  assert.ok(isChangeOrRevisionQuestion("Show the revisions"));
  assert.ok(!isChangeOrRevisionQuestion("Is 20 days reasonable?"));
});

test("baseline-only programme is detected when only one revision exists", () => {
  const pkg = baselineOnlyPkg();
  assert.ok(isBaselineOnlyProgramme(pkg));
  assert.ok(isBaselineOnlyConversationState(pkg));
});

test("awaiting first update is detected when no revisions are recorded", () => {
  const pkg = awaitingUpdatePkg();
  assert.ok(isBaselineOnlyConversationState(pkg));
  assert.ok(!isBaselineOnlyProgramme(pkg));
});

test("baseline-only conversation answer uses planner language", () => {
  const answer = buildBaselineOnlyConversationAnswer(baselineOnlyPkg());
  assert.match(answer, /Nothing has changed yet/i);
  assert.match(answer, /only contains the Baseline programme/i);
  assert.match(answer, /first programme update/i);
  assert.match(answer, /what changed/i);
  assert.doesNotMatch(answer, /not enough evidence/i);
  assert.doesNotMatch(answer, /revision history available/i);
});

test("humanizes technical evidence gaps", () => {
  const gap = humanizeBaselineOnlyGap("No revision history on this project yet.");
  assert.match(gap, /aren't any programme updates/i);
  assert.match(gap, /only the Baseline/i);
  assert.doesNotMatch(gap, /revision history on this project yet/i);
});

test("verification suppresses technical missing-evidence for baseline-only change questions", () => {
  const result = verifyPlannerQuestion({
    question: "What changed?",
    evidencePackage: baselineOnlyPkg(),
  });
  assert.equal(result.relevantMissingEvidence.length, 0);
});

test("verification humanizes gaps for awaiting-first-update change questions", () => {
  const result = verifyPlannerQuestion({
    question: "What changed since baseline?",
    evidencePackage: awaitingUpdatePkg(),
  });
  assert.equal(result.relevantMissingEvidence.length, 0);
});

test("knowledge package leads with baseline-only conclusions for change questions", () => {
  const knowledge = buildKnowledge("What changed?", baselineOnlyPkg());
  assert.ok(
    knowledge.supportedConclusions.some((c) => /Nothing has changed yet/i.test(c)),
    "expected supported conclusion about no changes"
  );
  assert.ok(
    knowledge.confirmedFacts.some((f) => /only contains the Baseline programme/i.test(f)),
    "expected confirmed fact in planner language"
  );
  assert.ok(
    knowledge.evidenceNotes.some((n) => /Do not apologise/i.test(n)),
    "expected guidance note for natural tone"
  );
  assert.ok(
    !knowledge.confirmedFacts.some((f) => /only one programme revision/i.test(f)),
    "should not surface technical intelligence summary"
  );
});

test("evolution facts for baseline-only avoid technical summaries", () => {
  const facts = buildEvolutionFactsForAnswer(baselineOnlyPkg());
  assert.equal(facts.length, 1);
  assert.match(facts[0], /Nothing has changed yet/i);
});
