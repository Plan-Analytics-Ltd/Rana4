import test from "node:test";
import assert from "node:assert/strict";
import { interpretPlannerQuery } from "../../dist/services/ask-rana/askRanaPlannerQueryInterpreter.service.js";
import { resolveEvidenceDomains } from "../../dist/services/ask-rana/askRanaEvidenceScopeResolver.service.js";
import { scopeInstructionForPrompt } from "../../dist/services/ask-rana/askRanaEvidenceScopeResolver.service.js";
import { buildAskRanaPrompt } from "../../dist/services/ask-rana/askRanaPrompt.builder.js";
import { buildAskRanaKnowledgePackage } from "../../dist/services/ask-rana/askRanaKnowledgePackage.service.js";
import { verifyPlannerQuestion } from "../../dist/services/ask-rana/askRanaQuestionVerification.service.js";
import { buildPlannerInvestigation } from "../../dist/services/ask-rana/askRanaInvestigation.service.js";
import { classifyPlannerResponseDepth } from "../../dist/services/ask-rana/askRanaResponseDepth.service.js";

function mockPkg(sources) {
  return {
    deliverable: { name: "Detailed Design", classification: "design", currentDurationDays: 5 },
    sources,
    evidenceGaps: [
      "Not enough completed projects imported for comparison.",
      "No revision history on this project yet.",
    ],
    projectEvolution: {
      available: true,
      baselineDays: 10,
      latestDays: 5,
      timelineHighlights: [],
      revisionHighlights: [],
      stablePeriods: [],
      revisions: [],
      plannerObservations: [],
    },
    previousProjects: { available: false },
  };
}

test("project evolution level duration question scopes to PROJECT_EVOLUTION", () => {
  const question = "On project evolution level, is this duration reasonable?";
  const query = interpretPlannerQuery(question);

  assert.equal(query.scope, "PROJECT_EVOLUTION");
  assert.notEqual(query.scope, "AUTO");
  assert.ok(["is_reasonable", "evaluate_duration"].includes(query.intent));

  const domains = resolveEvidenceDomains(query, question);
  assert.ok(domains.includes("projectEvolution"));
  assert.ok(!domains.includes("previousProjects"));
  assert.ok(!domains.includes("lessonsLearned"));
});

test("compared with previous projects scopes to PREVIOUS_PROJECTS", () => {
  const question = "Compared with previous projects, is this duration reasonable?";
  const query = interpretPlannerQuery(question);

  assert.equal(query.scope, "PREVIOUS_PROJECTS");
  assert.equal(query.comparisonMode, "previous_projects");

  const domains = resolveEvidenceDomains(query, question);
  assert.ok(domains.includes("previousProjects"));
  assert.ok(!domains.includes("projectEvolution"));
  assert.ok(!domains.includes("programmeLogic"));
});

test("ignoring previous projects what changed scopes to PROJECT_EVOLUTION", () => {
  const question = "Ignoring previous projects, what changed?";
  const query = interpretPlannerQuery(question);

  assert.equal(query.scope, "PROJECT_EVOLUTION");
  assert.equal(query.intent, "what_changed");
  assert.ok(query.qualifiers.includes("ignore_previous_projects"));

  const domains = resolveEvidenceDomains(query, question);
  assert.ok(domains.includes("projectEvolution"));
  assert.ok(!domains.includes("previousProjects"));
});

test("portfolio-wide slips scopes to PORTFOLIO", () => {
  const question = "Portfolio-wide, what usually slips?";
  const query = interpretPlannerQuery(question);

  assert.equal(query.scope, "PORTFOLIO");
  assert.ok(["risk", "lessons"].includes(query.intent));

  const domains = resolveEvidenceDomains(query, question);
  assert.ok(domains.includes("lessonsLearned") || domains.includes("previousProjects"));
  assert.ok(!domains.includes("projectEvolution"));
});

test("programme logic perspective resolves logic domains only", () => {
  const question = "From a programme logic perspective, what happened?";
  const query = interpretPlannerQuery(question);

  assert.equal(query.intent, "logic_change");

  const domains = resolveEvidenceDomains(query, question);
  assert.ok(domains.includes("programmeLogic"));
  assert.ok(!domains.includes("previousProjects"));
});

test("prompt includes structured planner query and scope instruction", () => {
  const question = "On project evolution level, is this duration reasonable?";
  const plannerQuery = interpretPlannerQuery(question);
  const pkg = mockPkg(["projectEvolution", "programmeLogic"]);
  const verification = verifyPlannerQuestion({
    question,
    evidencePackage: pkg,
    plannerQuery,
  });

  const responseDepth = classifyPlannerResponseDepth({ question, plannerQuery });
  const knowledge = buildAskRanaKnowledgePackage({
    evidencePackage: pkg,
    plannerQuery,
    verification,
    responseDepth,
    investigation: buildPlannerInvestigation({
      question,
      evidencePackage: pkg,
      plannerQuery,
      depth: responseDepth.depth,
      followUpIntent: responseDepth.followUpIntent,
    }),
  });
  const prompt = buildAskRanaPrompt({ question, knowledge });

  assert.ok(prompt.user.includes("Planner context"));
  assert.ok(prompt.user.includes("Intent:"));
  assert.ok(prompt.user.includes("Evidence scope: Project Evolution only"));
  assert.ok(prompt.user.includes("Planner asked:"));
  assert.ok(scopeInstructionForPrompt(plannerQuery)?.includes("Project Evolution"));
});

test("PROJECT_EVOLUTION scope suppresses previous-project gap apologies", () => {
  const question = "On project evolution level, is this duration reasonable?";
  const plannerQuery = interpretPlannerQuery(question);
  const pkg = mockPkg(["projectEvolution"]);
  const verification = verifyPlannerQuestion({
    question,
    evidencePackage: pkg,
    plannerQuery,
  });

  assert.ok(
    !verification.relevantMissingEvidence.some((m) => /completed project/i.test(m)),
    "should not surface previous-project gaps when scope is project evolution"
  );
  const knowledge = buildAskRanaKnowledgePackage({
    evidencePackage: pkg,
    plannerQuery,
    verification,
    responseDepth: classifyPlannerResponseDepth({ question, plannerQuery }),
    investigation: buildPlannerInvestigation({
      question,
      evidencePackage: pkg,
      plannerQuery,
      depth: "STANDARD",
      followUpIntent: "none",
    }),
  });
  assert.ok(knowledge.evidenceNotes.some((n) => /Evidence boundary: Project Evolution only/i.test(n)));
});
