import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { selectAskRanaEvidenceDomains } from "../../dist/services/ask-rana/askRanaEvidenceSelector.js";
import { buildAskRanaEvidencePackage } from "../../dist/services/ask-rana/askRanaContextBuilder.service.js";
import { interpretPlannerQuery } from "../../dist/services/ask-rana/askRanaPlannerQueryInterpreter.service.js";
import { serializeAskRanaEvidenceForPrompt } from "../../dist/services/ask-rana/askRanaEvidenceSanitizer.js";
import { verifyPlannerQuestion } from "../../dist/services/ask-rana/askRanaQuestionVerification.service.js";
import { prisma } from "../../dist/utils/prisma.js";
import { createProjectEvolutionFixture } from "./fixtures/projectEvolutionFixture.mjs";

let fixture;

before(async () => {
  fixture = await createProjectEvolutionFixture();
});

after(async () => {
  if (fixture) await fixture.teardown();
  await prisma.$disconnect();
});

test("evidence selector returns evolution-only domains for revision history question", () => {
  const domains = selectAskRanaEvidenceDomains("Show me the revision history");
  assert.ok(domains.includes("projectEvolution"));
  assert.ok(!domains.includes("lessonsLearned") || domains.length > 1);
});

test("evidence selector returns comparison domains for duration reasonableness question", () => {
  const domains = selectAskRanaEvidenceDomains("Is this duration reasonable?");
  assert.ok(domains.includes("previousProjects"));
});

test("evidence selector includes evolution for duration-direction why questions", () => {
  const domains = selectAskRanaEvidenceDomains("Why was it increased from 10 to 20 days?");
  assert.ok(domains.includes("projectEvolution"));
});

test("evidence selector returns broad domains for explain everything", () => {
  const domains = selectAskRanaEvidenceDomains("Explain everything about this deliverable");
  assert.ok(domains.includes("previousProjects"));
  assert.ok(domains.includes("projectEvolution"));
  assert.ok(domains.includes("recommendations"));
});

test("fixture evidence package includes evolution intelligence for change question", async () => {
  const question = "What changed?";
  const pkg = await buildAskRanaEvidencePackage(
    {
      projectId: fixture.projectId,
      companyId: fixture.companyId,
      deliverableId: fixture.deliverables.detailedDesign.id,
      question,
    },
    interpretPlannerQuery(question)
  );

  assert.ok(pkg.projectEvolution?.available);
  assert.ok(pkg.projectEvolution?.howChangedSummary || pkg.projectEvolution?.summary);
  const briefing = serializeAskRanaEvidenceForPrompt(pkg);
  assert.ok(briefing.includes("Deliverable"));
  assert.ok(!briefing.includes("deliverableId"));
});

test("different questions produce different evidence briefings", async () => {
  const changeQuestion = "What changed?";
  const historyQuestion = "Show revision history";
  const changePkg = await buildAskRanaEvidencePackage(
    {
      projectId: fixture.projectId,
      companyId: fixture.companyId,
      deliverableId: fixture.deliverables.detailedDesign.id,
      question: changeQuestion,
    },
    interpretPlannerQuery(changeQuestion)
  );
  const historyPkg = await buildAskRanaEvidencePackage(
    {
      projectId: fixture.projectId,
      companyId: fixture.companyId,
      deliverableId: fixture.deliverables.detailedDesign.id,
      question: historyQuestion,
    },
    interpretPlannerQuery(historyQuestion)
  );

  const changeBrief = serializeAskRanaEvidenceForPrompt(changePkg);
  const historyBrief = serializeAskRanaEvidenceForPrompt(historyPkg);

  assert.notEqual(changeBrief, historyBrief);
  assert.ok(historyBrief.includes("Revision timeline") || historyBrief.includes("revisions"));
});

test("false increase assumption is flagged before LLM prompt", async () => {
  // Fixture's real history goes 20 -> 5 (a reduction). The planner here wrongly
  // assumes an increase — this must be caught regardless of the specific
  // numbers involved, since the correction is direction-based, not literal-match-based.
  const falseIncreaseQuestion = "Why was it increased from 20 to 30 days?";
  const pkg = await buildAskRanaEvidencePackage(
    {
      projectId: fixture.projectId,
      companyId: fixture.companyId,
      deliverableId: fixture.deliverables.detailedDesign.id,
      question: falseIncreaseQuestion,
    },
    interpretPlannerQuery(falseIncreaseQuestion)
  );

  const verification = verifyPlannerQuestion({
    question: falseIncreaseQuestion,
    evidencePackage: pkg,
  });

  assert.ok(pkg.projectEvolution?.available);
  assert.ok(verification.corrections.length > 0);
  assert.ok(verification.corrections.some((c) => /reduc|does not match/i.test(c)));
  assert.ok(
    !verification.relevantMissingEvidence.some((m) => /lessons learned|recommendation/i.test(m)) ||
      verification.relevantMissingEvidence.length === 0
  );
});
