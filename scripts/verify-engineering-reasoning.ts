/**
 * Verifies the Engineering Reasoning layer reaches the same conclusion an
 * experienced planner would — without relying on wording similarity or
 * taxonomy equality alone.
 *
 * Each case resolves a validated Engineering Identity for both deliverables,
 * then compares the *understanding* (discipline / engineering object /
 * engineering work), printing the explainable diagnostics.
 *
 *   npx tsx scripts/verify-engineering-reasoning.ts
 */
import { resolveEngineeringIdentity } from "../src/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../src/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import { explainEngineeringComparison } from "../src/services/intelligence/taxonomy/engineeringReasoning.service.js";

type Case = {
  title: string;
  target: { name: string; fragnet?: string | null };
  candidate: { name: string; fragnet?: string | null };
  plannerVerdict: "EQUIVALENT" | "DIFFERENT";
};

const CASES: Case[] = [
  {
    title: "Same reinforcement detailing, different wording",
    target: { name: "Reinforcement Detailing", fragnet: "Structures" },
    candidate: { name: "Produce Reinforcement Detailing", fragnet: "Foundations" },
    plannerVerdict: "EQUIVALENT",
  },
  {
    title: "Fire vs mechanical technical note — same document, different engineering",
    target: { name: "Mechanical Technical Note", fragnet: "Mechanical" },
    candidate: { name: "Fire Technical Note", fragnet: "Fire Engineering" },
    plannerVerdict: "DIFFERENT",
  },
  {
    title: "Link bridge vs stockpile — wording overlaps, engineering does not",
    target: { name: "VI-052 Link Bridge - Option 1 (Early Stage 3 Structural Analysis)", fragnet: "Link Structure" },
    candidate: { name: "Detailed Design - Southern Stockpile Benefits Analysis", fragnet: "Detailed Design" },
    plannerVerdict: "DIFFERENT",
  },
  {
    title: "Primary steelwork vs lift cladding — different physical asset",
    target: { name: "Primary Steelwork (Plant Screen)", fragnet: "Level 11" },
    candidate: { name: "TC-314 - EI-613 - Conventional station steelwork and cladding - EoP Lifts Cladding" },
    plannerVerdict: "DIFFERENT",
  },
  {
    title: "Public health technical notes — same engineering, reordered wording",
    target: { name: "Public Health Technical Note", fragnet: "Public Health" },
    candidate: { name: "Technical Notes - Public Health", fragnet: "Public Health" },
    plannerVerdict: "EQUIVALENT",
  },
];

function identity(name: string, fragnet?: string | null) {
  return enforceEngineeringIdentityValidation(
    resolveEngineeringIdentity({ deliverableName: name, fragnetName: fragnet ?? null })
  );
}

function summariseIdentity(label: string, id: ReturnType<typeof identity>): void {
  console.log(
    `    ${label}: discipline=${id.discipline.id ?? "?"}, object=${id.engineeringObject.id ?? "?"}, work=${id.engineeringWork.id ?? "?"} (status=${id.status})`
  );
}

let passed = 0;
for (const testCase of CASES) {
  const target = identity(testCase.target.name, testCase.target.fragnet);
  const candidate = identity(testCase.candidate.name, testCase.candidate.fragnet);
  const explanation = explainEngineeringComparison(target, candidate);
  const ranaVerdict = explanation.equivalent ? "EQUIVALENT" : "DIFFERENT";
  const agree = ranaVerdict === testCase.plannerVerdict;
  passed += agree ? 1 : 0;

  console.log(`\n${agree ? "PASS" : "FAIL"} — ${testCase.title}`);
  console.log(`  planner=${testCase.plannerVerdict}  rana=${ranaVerdict}  reason=${explanation.reason}`);
  summariseIdentity("target   ", target);
  summariseIdentity("candidate", candidate);
  if (explanation.equivalent) {
    console.log(`    matched on: ${explanation.matched.map((m) => `${m.component}=${m.value}`).join(", ")}`);
  } else {
    console.log(`    rejected on: ${explanation.rejected.map((r) => `${r.component}(${r.target}≠${r.candidate})`).join(", ")}`);
  }
}

console.log(`\n${passed}/${CASES.length} comparisons match the experienced-planner verdict.`);
process.exit(passed === CASES.length ? 0 : 1);
