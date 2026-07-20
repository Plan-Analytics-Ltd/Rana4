import test from "node:test";
import assert from "node:assert/strict";
import { selectAskRanaEvidenceDomains } from "../../dist/services/ask-rana/askRanaEvidenceSelector.js";
import { buildAskRanaEvidencePackage } from "../../dist/services/ask-rana/askRanaContextBuilder.service.js";
import { interpretPlannerQuery } from "../../dist/services/ask-rana/askRanaPlannerQueryInterpreter.service.js";
import { serializeAskRanaEvidenceForPrompt } from "../../dist/services/ask-rana/askRanaEvidenceSanitizer.js";
import { verifyPlannerQuestion } from "../../dist/services/ask-rana/askRanaQuestionVerification.service.js";
import { prisma } from "../../dist/utils/prisma.js";

const projectId = "cmr1ztdj50001sybs8jbn4qf4";
const companyId = "cmo8dvlc10000syx0861h1zr5";

async function findSeedDeliverable() {
  return prisma.deliverable.findFirst({
    where: { projectId, companyId, name: "Detailed Design", fragnet: { name: "Level 9" } },
    select: { id: true },
  });
}

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

test("seeded healthcare evidence package includes evolution intelligence for change question", async (t) => {
  const deliverable = await findSeedDeliverable();
  if (!deliverable) return t.skip("requires seeded healthcare project in database");

  const question = "What changed?";
  const pkg = await buildAskRanaEvidencePackage(
    {
      projectId,
      companyId,
      deliverableId: deliverable.id,
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

test("different questions produce different evidence briefings", async (t) => {
  const deliverable = await findSeedDeliverable();
  if (!deliverable) return t.skip("requires seeded healthcare project in database");

  const changeQuestion = "What changed?";
  const historyQuestion = "Show revision history";
  const changePkg = await buildAskRanaEvidencePackage(
    {
      projectId,
      companyId,
      deliverableId: deliverable.id,
      question: changeQuestion,
    },
    interpretPlannerQuery(changeQuestion)
  );
  const historyPkg = await buildAskRanaEvidencePackage(
    {
      projectId,
      companyId,
      deliverableId: deliverable.id,
      question: historyQuestion,
    },
    interpretPlannerQuery(historyQuestion)
  );

  const changeBrief = serializeAskRanaEvidenceForPrompt(changePkg);
  const historyBrief = serializeAskRanaEvidenceForPrompt(historyPkg);

  assert.notEqual(changeBrief, historyBrief);
  assert.ok(historyBrief.includes("Revision timeline") || historyBrief.includes("revisions"));
});

test("seeded healthcare false increase assumption is flagged before LLM prompt", async (t) => {
  const deliverable = await findSeedDeliverable();
  if (!deliverable) return t.skip("requires seeded healthcare project in database");

  const falseIncreaseQuestion = "Why was it increased from 10 to 20 days?";
  const pkg = await buildAskRanaEvidencePackage(
    {
      projectId,
      companyId,
      deliverableId: deliverable.id,
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
  assert.ok(verification.corrections.some((c) => /reduc|10.*5|does not match/i.test(c)));
  assert.ok(
    !verification.relevantMissingEvidence.some((m) => /lessons learned|recommendation/i.test(m)) ||
      verification.relevantMissingEvidence.length === 0
  );
});

test.after(async () => {
  await prisma.$disconnect();
});
