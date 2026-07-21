import test from "node:test";
import assert from "node:assert/strict";
import { buildAskRanaKnowledgePackage } from "../../dist/services/ask-rana/askRanaKnowledgePackage.service.js";
import { serializeKnowledgePackageForPrompt } from "../../dist/services/ask-rana/askRanaKnowledgeSerializer.js";
import { buildAskRanaPrompt, ASK_RANA_SYSTEM_PROMPT } from "../../dist/services/ask-rana/askRanaPrompt.builder.js";
import { interpretPlannerQuery } from "../../dist/services/ask-rana/askRanaPlannerQueryInterpreter.service.js";
import { verifyPlannerQuestion } from "../../dist/services/ask-rana/askRanaQuestionVerification.service.js";
import { buildPlannerInvestigation } from "../../dist/services/ask-rana/askRanaInvestigation.service.js";
import { classifyPlannerResponseDepth } from "../../dist/services/ask-rana/askRanaResponseDepth.service.js";
import {
  buildRevisionChangeSummaries,
  extractRevisionTarget,
  isBroadChangeQuestion,
} from "../../dist/services/ask-rana/askRanaConversationPolish.service.js";

function mockPkg(overrides = {}) {
  return {
    deliverable: { name: "Reinforcement Detailing", classification: "design", currentDurationDays: 5 },
    sources: ["projectEvolution", "programmeLogic"],
    evidenceGaps: [],
    projectEvolution: {
      available: true,
      revisionCount: 4,
      baselineDays: 73,
      latestDays: 5,
      netChangeDays: -68,
      summary: "Duration reduced from 73 to 5 days.",
      howChangedSummary: "Reduced over programme updates.",
      timelineHighlights: ["Baseline set duration at 73 days."],
      revisionHighlights: [
        {
          label: "Update 1",
          role: "UPDATE",
          durationDays: 5,
          changeDays: -68,
          reason: "Duration reduced to 5 days.",
        },
        {
          label: "Update 2",
          role: "UPDATE",
          durationDays: 5,
          changeDays: 0,
          reason: "Duration unchanged in this update.",
        },
      ],
      stablePeriods: [],
      revisions: [
        { label: "Baseline", role: "BASELINE", importedAt: "2024-01-01", durationDays: 73, durationChangeDays: null },
        { label: "Update 1", role: "UPDATE", importedAt: "2024-01-15", durationDays: 5, durationChangeDays: -68 },
        { label: "Update 2", role: "UPDATE", importedAt: "2024-02-01", durationDays: 5, durationChangeDays: 0 },
      ],
      plannerObservations: [
        "The imported programme history does not record why float reduced at Update 3.",
      ],
      showFullTimeline: false,
    },
    programmeLogic: {
      available: true,
      summary: "Float reduced before criticality.",
      revisions: [
        {
          label: "Update 1",
          relationshipCount: 2,
          relationshipCountChange: 0,
          events: [{ type: "DURATION_CHANGE", activityCode: "A1", description: "Duration reduced to 5 days." }],
          plannerObservations: [],
        },
        {
          label: "Update 2",
          relationshipCount: 2,
          relationshipCountChange: 0,
          events: [{ type: "FLOAT_LOST", activityCode: "A1", description: "float reduced from 73 to 60 days" }],
          plannerObservations: ["Duration was unchanged in this revision."],
        },
      ],
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
    question,
  });
}

test("isBroadChangeQuestion detects broad what changed without attribute", () => {
  const broad = interpretPlannerQuery("What changed?");
  assert.equal(isBroadChangeQuestion("What changed?", broad), true);
  assert.equal(isBroadChangeQuestion("What changed to the duration?", broad), false);
  assert.equal(isBroadChangeQuestion("What changed to the float?", interpretPlannerQuery("What changed to the float?")), false);
});

test("buildRevisionChangeSummaries states single-attribute change and unchanged others", () => {
  const pkg = mockPkg({
    projectEvolution: {
      ...mockPkg().projectEvolution,
      revisionHighlights: [
        {
          label: "Update 2",
          role: "UPDATE",
          durationDays: 5,
          changeDays: 0,
          reason: "Duration unchanged in this update.",
        },
      ],
      revisions: [
        { label: "Baseline", role: "BASELINE", importedAt: "2024-01-01", durationDays: 73, durationChangeDays: null },
        { label: "Update 2", role: "UPDATE", importedAt: "2024-02-01", durationDays: 5, durationChangeDays: 0 },
      ],
    },
    programmeLogic: {
      available: true,
      summary: "Float reduced before criticality.",
      revisions: [
        {
          label: "Update 2",
          relationshipCount: 2,
          relationshipCountChange: 0,
          events: [
            {
              type: "FLOAT_LOST",
              activityCode: "A1",
              description: "float reduced from 73 to 60 days",
            },
          ],
          plannerObservations: ["Duration was unchanged in this revision."],
        },
      ],
    },
  });
  const summaries = buildRevisionChangeSummaries(pkg);

  assert.ok(summaries.some((s) => /Update 2/i.test(s)));
  assert.ok(summaries.some((s) => /did not change duration/i.test(s)));
  assert.ok(summaries.some((s) => /did not change.*logic/i.test(s)));
  assert.ok(summaries.some((s) => /only recorded change/i.test(s)));
  assert.ok(summaries.some((s) => /float/i.test(s)));
});

test("broad what changed question adds change summaries and communication guidance", () => {
  const knowledge = buildKnowledge("What changed?", mockPkg());
  const serialized = serializeKnowledgePackageForPrompt(knowledge);

  assert.ok(knowledge.changeSummaries.length > 0);
  assert.ok(knowledge.communicationGuidance.length > 0);
  assert.ok(serialized.includes("What changed by revision"));
  assert.ok(serialized.includes("How to reason and communicate"));
  assert.ok(knowledge.conversationContext.plannerExpectation.includes("remaining work, planning, float, criticality, logic"));
});

test("unknowns use programme-file wording not imported programme repetition", () => {
  const knowledge = buildKnowledge("What changed?", mockPkg());
  const serialized = serializeKnowledgePackageForPrompt(knowledge);

  assert.ok(knowledge.unknowns.some((u) => /programme file/i.test(u)));
  assert.ok(!knowledge.unknowns.some((u) => /imported programme history does not record/i.test(u)));
  assert.ok(serialized.includes("Not in the programme file"));
  assert.ok(!serialized.includes("not recorded in the imported programme"));
});

test("prompt system rules cover change storytelling and confident tone", () => {
  assert.ok(ASK_RANA_SYSTEM_PROMPT.includes("Broad “what changed?”"));
  assert.ok(ASK_RANA_SYSTEM_PROMPT.includes("The revision history shows"));
  assert.ok(ASK_RANA_SYSTEM_PROMPT.includes("REVISION-SPECIFIC QUESTIONS"));

  const prompt = buildAskRanaPrompt({
    question: "What changed?",
    knowledge: buildKnowledge("What changed?", mockPkg()),
  });
  assert.ok(prompt.user.includes("What changed by revision"));
});

test("specific attribute change question does not add broad change summaries", () => {
  const knowledge = buildKnowledge("What changed to the duration?", mockPkg());
  assert.equal(knowledge.changeSummaries.length, 0);
});

test("revision-specific question targets Update 2 first", () => {
  const pkg = mockPkg();
  const knowledge = buildKnowledge("What changed in Update 2?", pkg);
  const serialized = serializeKnowledgePackageForPrompt(knowledge);

  assert.equal(knowledge.targetRevision, "Update 2");
  assert.ok(knowledge.communicationGuidance.some((g) => /Update 2 specifically/i.test(g)));
  assert.ok(knowledge.communicationGuidance.some((g) => /Never open with Baseline/i.test(g)));
  assert.ok(!knowledge.communicationGuidance.some((g) => /Baseline → early updates/i.test(g)));
  assert.equal(knowledge.changeSummaries.length, 1);
  assert.ok(knowledge.changeSummaries[0].includes("Update 2"));
  assert.ok(serialized.includes("Target revision: Update 2"));
  assert.ok(serialized.includes("Confirmed facts for Update 2"));
  assert.ok(!knowledge.confirmedFacts.some((f) => /Baseline set duration/i.test(f)));
  assert.ok(!knowledge.confirmedFacts.some((f) => /^Duration: baseline/i.test(f)));
});

test("revision-specific question includes neighbouring context not full history", () => {
  const knowledge = buildKnowledge("What changed in Update 2?", mockPkg());

  assert.ok(knowledge.revisionContextFacts.some((f) => /Earlier supporting context/i.test(f)));
  assert.ok(knowledge.revisionContextFacts.some((f) => /Update 1/i.test(f)));
});

test("tell me the story of Update 2 is revision-scoped not whole-project", () => {
  const knowledge = buildKnowledge("Tell me the story of Update 2.", mockPkg());

  assert.equal(knowledge.targetRevision, "Update 2");
  assert.ok(knowledge.communicationGuidance.some((g) => /Start with Update 2 only/i.test(g)));
});

test("what changed since baseline is not revision-scoped to Baseline", () => {
  assert.equal(extractRevisionTarget("What changed since baseline?", mockPkg()), null);
});

test("whole-project evolution question keeps chronological guidance", () => {
  const knowledge = buildKnowledge("How has this changed over time?", mockPkg());

  assert.equal(knowledge.targetRevision, null);
  assert.ok(knowledge.communicationGuidance.some((g) => /Baseline → early updates/i.test(g)));
});

test("latest update question resolves to canonical numbered revision", () => {
  const knowledge = buildKnowledge("What changed in the Latest Update?", mockPkg());

  assert.equal(knowledge.targetRevision, "Update 2");
  assert.ok(knowledge.changeSummaries.some((s) => /Update 2/i.test(s)));
  assert.ok(knowledge.changeSummaries.some((s) => /float/i.test(s)));
});

test("update 2 and latest update share the same revision facts", () => {
  const pkg = mockPkg();
  const byNumber = buildKnowledge("What changed in Update 2?", pkg);
  const byLatest = buildKnowledge("What changed in the Latest Update?", pkg);

  assert.equal(byNumber.targetRevision, "Update 2");
  assert.equal(byLatest.targetRevision, "Update 2");
  assert.deepEqual(byNumber.changeSummaries, byLatest.changeSummaries);
  assert.ok(byNumber.confirmedFacts.some((f) => /float/i.test(f)));
  assert.ok(byLatest.confirmedFacts.some((f) => /float/i.test(f)));
});
