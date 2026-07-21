import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlannerInvestigation,
  buildInvestigationFindings,
  detectInvestigationMode,
  extractDeterministicInvestigationSignals,
} from "../../dist/services/ask-rana/askRanaInvestigation.service.js";
import { interpretPlannerQuery } from "../../dist/services/ask-rana/askRanaPlannerQueryInterpreter.service.js";
import { verifyPlannerQuestion } from "../../dist/services/ask-rana/askRanaQuestionVerification.service.js";
import { buildAskRanaPrompt } from "../../dist/services/ask-rana/askRanaPrompt.builder.js";
import { buildAskRanaKnowledgePackage } from "../../dist/services/ask-rana/askRanaKnowledgePackage.service.js";
import { classifyPlannerResponseDepth } from "../../dist/services/ask-rana/askRanaResponseDepth.service.js";

function mockInvestigationPkg(overrides = {}) {
  return {
    deliverable: { name: "Detailed Design", classification: "design", currentDurationDays: 5 },
    sources: ["projectEvolution", "programmeLogic"],
    evidenceGaps: [],
    projectEvolution: {
      available: true,
      baselineDays: 5,
      latestDays: 5,
      netChangeDays: 0,
      summary: "Duration stable at 5 days.",
      stablePeriods: [
        { startLabel: "Update 2", endLabel: "As-built", durationDays: 5, revisionCount: 11 },
      ],
      timelineHighlights: [],
      plannerObservations: [],
      revisionHighlights: [],
      revisions: [],
      showFullTimeline: false,
    },
    programmeLogic: {
      available: true,
      summary: "Float reduced across several updates before criticality.",
      revisions: [
        {
          label: "Update 2",
          relationshipCount: 4,
          relationshipCountChange: 0,
          events: [{ type: "FLOAT_LOST", activityCode: "A1", description: "Lost scheduling flexibility." }],
          plannerObservations: ["Duration was unchanged in this revision."],
        },
        {
          label: "Update 3",
          relationshipCount: 4,
          relationshipCountChange: 0,
          events: [{ type: "FLOAT_LOST", activityCode: "A1", description: "Lost more scheduling flexibility." }],
          plannerObservations: [],
        },
        {
          label: "Update 5",
          relationshipCount: 3,
          relationshipCountChange: -1,
          events: [
            {
              type: "BECAME_CRITICAL",
              activityCode: "A1",
              description: "This activity became critical because it lost all scheduling flexibility.",
            },
            {
              type: "RELATIONSHIP_REMOVED",
              activityCode: "A1",
              description: "A Finish-to-Start dependency was removed.",
            },
          ],
          plannerObservations: [],
        },
        {
          label: "Update 8",
          relationshipCount: 3,
          relationshipCountChange: 0,
          events: [
            {
              type: "LEFT_CRITICAL",
              activityCode: "A1",
              description: "This activity left the critical path and gained scheduling flexibility.",
            },
          ],
          plannerObservations: [],
        },
      ],
    },
    ...overrides,
  };
}

test("detects why and deep investigation modes", () => {
  const whyQuery = interpretPlannerQuery("Why did this become critical?");
  assert.equal(
    detectInvestigationMode("Why did this become critical?", whyQuery, undefined, "INVESTIGATION"),
    "why"
  );

  const deepQuery = interpretPlannerQuery("Investigate why the float reduced.");
  assert.equal(
    detectInvestigationMode("Investigate why the float reduced.", deepQuery, undefined, "INVESTIGATION"),
    "deep"
  );
  assert.equal(deepQuery.intent, "investigate");
});

test("extracts cross-evidence signals including duration unchanged and progressive float loss", () => {
  const pkg = mockInvestigationPkg();
  const signals = extractDeterministicInvestigationSignals(pkg);

  assert.ok(signals.some((s) => /remaining work remained unchanged/i.test(s)));
  assert.ok(signals.some((s) => /progressively|scheduling flexibility reduced/i.test(s)));
  assert.ok(signals.some((s) => /became critical at.*Update 5/i.test(s)));
  assert.ok(signals.some((s) => /left the critical path/i.test(s)));
});

test("why is critical triggers current-state correction and continues investigation", () => {
  const pkg = mockInvestigationPkg();
  const question = "Why is this critical?";
  const plannerQuery = interpretPlannerQuery(question);
  const verification = verifyPlannerQuestion({
    question,
    evidencePackage: pkg,
    plannerQuery,
  });

  assert.ok(verification.corrections.some((c) => /isn't currently critical|not currently critical/i.test(c)));
  assert.ok(verification.corrections.some((c) => /do not stop after the correction/i.test(c)));
});

test("investigation produces structured findings not instruction blocks", () => {
  const pkg = mockInvestigationPkg();
  const question = "Investigate why the float reduced.";
  const plannerQuery = interpretPlannerQuery(question);
  const responseDepth = classifyPlannerResponseDepth({ question, plannerQuery });
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

  assert.equal(investigation.mode, "deep");
  assert.ok(investigation.findings);
  assert.ok(investigation.findings.ruledOutExplanations.some((r) => /remaining.work/i.test(r)));
  assert.ok(investigation.findings.supportedConclusions.length > 0);
  assert.ok(investigation.findings.evidenceLinks.length > 0);

  const findings = buildInvestigationFindings(pkg, "deep");
  assert.ok(findings?.strongestConclusion);

  const knowledge = buildAskRanaKnowledgePackage({
    evidencePackage: pkg,
    plannerQuery,
    verification,
    responseDepth,
    investigation,
  });
  const prompt = buildAskRanaPrompt({ question, knowledge });

  assert.ok(!prompt.user.includes("INVESTIGATION MODE"));
  assert.ok(prompt.user.includes("Ruled-out explanations"));
  assert.ok(prompt.user.includes("Remaining work remained unchanged"));
});

test("summarise everything uses report depth expectation", async () => {
  const { ASK_RANA_SYSTEM_PROMPT } = await import(
    "../../dist/services/ask-rana/askRanaPrompt.builder.js"
  );
  const pkg = mockInvestigationPkg();
  const question = "Summarise everything about this deliverable.";
  const plannerQuery = interpretPlannerQuery(question);
  const verification = verifyPlannerQuestion({
    question,
    evidencePackage: pkg,
    plannerQuery,
    responseDepth: "REPORT",
  });
  const responseDepth = classifyPlannerResponseDepth({ question, plannerQuery });

  assert.equal(verification.responseStyle, "detailed");
  assert.equal(responseDepth.depth, "REPORT");
  assert.ok(responseDepth.plannerExpectation.includes("executive programme assessment"));
  assert.ok(ASK_RANA_SYSTEM_PROMPT.includes("knowledge package"));
});

test("follow-up investigate further is treated as deepen not restart", () => {
  const pkg = mockInvestigationPkg();
  const conversation = [
    { role: "planner", content: "Why did it become critical?" },
    {
      role: "rana",
      content:
        "### Summary\n\nIt became critical at Update 5.\n\n### Reasoning\n\nFloat reduced progressively.\n\n### Evidence\n\n- Update 5: became critical\n- Duration unchanged throughout the revision history on this deliverable",
    },
  ];
  const question = "Can you investigate further?";
  const plannerQuery = interpretPlannerQuery(question);
  const responseDepth = classifyPlannerResponseDepth({
    question,
    plannerQuery,
    conversation,
  });
  const investigation = buildPlannerInvestigation({
    question,
    evidencePackage: pkg,
    plannerQuery,
    conversation,
    depth: responseDepth.depth,
    followUpIntent: responseDepth.followUpIntent,
  });

  assert.equal(responseDepth.depth, "INVESTIGATION");
  assert.equal(investigation.mode, "deep");
  assert.ok(investigation.findings);
});
