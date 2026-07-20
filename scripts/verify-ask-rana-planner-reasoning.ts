/**
 * Unit checks for Ask Rana planner-reasoning helpers (no analytics).
 * Run: npx tsx scripts/verify-ask-rana-planner-reasoning.ts
 */
import {
  buildPlannerReasoningGuidance,
  compressConfirmedFactsForFollowUp,
  extractEstablishedProgrammeFacts,
  isExecutivePlannerQuestion,
  reframeLimitationPhrases,
} from "../src/services/ask-rana/askRanaPlannerReasoning.service.js";
import { ASK_RANA_SYSTEM_PROMPT } from "../src/services/ask-rana/askRanaPrompt.builder.js";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const conversation = [
  {
    role: "planner" as const,
    content: "If you were reviewing this programme before submission, what would concern you most?",
  },
  {
    role: "rana" as const,
    content:
      "My assessment is that the programme is showing moderate signs of pressure. There isn't enough completed project history yet to benchmark confidently. Four work packages increased remaining work, with Additional Structural Works +8 days and no replanning. I would review Additional Structural Works first.",
  },
];

assert(isExecutivePlannerQuestion("Overall, how healthy is this programme?"), "health is executive");
assert(isExecutivePlannerQuestion("Would you approve it?"), "approve is executive");
assert(isExecutivePlannerQuestion("What do you know confidently?"), "confidence is executive");
assert(!isExecutivePlannerQuestion("Why did Update 2 change float?"), "float why is not executive");

const established = extractEstablishedProgrammeFacts(conversation);
assert(established.some((e) => /historical benchmarking/i.test(e)), "detects thin benchmarking");
assert(established.some((e) => /Additional Structural Works/i.test(e)), "detects ASW");
assert(established.some((e) => /four work packages/i.test(e)), "detects 4 WPs");

const facts = [
  "Project Intelligence — Northvale",
  "Comparable completed projects: 0 · Overall confidence: LOW",
  "3 programme revisions · 4 work packages with increasing remaining work",
  "Priority 1: Review Additional Structural Works — Largest remaining-work increase of +8 days",
  "Priority 2: Review Foo — something new",
  "Priority 3: Review Bar — skip on follow-up",
  "Remaining work trend still useful",
];

const compressed = compressConfirmedFactsForFollowUp(facts, established, true);
assert(
  !compressed.some((f) => /Comparable completed projects:\s*0/i.test(f)),
  "removes zero-peer count on follow-up"
);
assert(
  compressed.some((f) => /Shared context|Conversation continuity/i.test(f)),
  "adds shared context note"
);
assert(!compressed.some((f) => /^Priority 3:/i.test(f)), "drops lower priorities when assessment given");

const guidance = buildPlannerReasoningGuidance({
  question: "Overall, how healthy is this programme?",
  isFollowUp: true,
  hasDetailedPriorAnswer: true,
  establishedFacts: established,
});
assert(guidance.some((g) => /judgement first/i.test(g)), "judgement-first guidance");
assert(guidance.some((g) => /Follow-up/i.test(g)), "follow-up guidance");
assert(guidance.some((g) => /Executive question/i.test(g)), "executive guidance");

const reframed = reframeLimitationPhrases(["I can't confirm plant details."]);
assert(!/^I can't/i.test(reframed[0]!), "reframes I can't");

assert(/Planning Director/i.test(ASK_RANA_SYSTEM_PROMPT), "prompt uses Planning Director voice");
assert(/Conclusion first/i.test(ASK_RANA_SYSTEM_PROMPT), "prompt requires conclusion first");
assert(/never name the same work package more than twice/i.test(ASK_RANA_SYSTEM_PROMPT), "repetition rule");
assert(/Avoid:.*The revision history shows/i.test(ASK_RANA_SYSTEM_PROMPT), "prompt tells model to avoid analytics phrasing");

console.log("PASS: Ask Rana planner-reasoning helpers");
