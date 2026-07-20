/**
 * Planner reasoning & conversation quality helpers for Ask Rana.
 * Communication only — does not change analytics or evidence computation.
 */

import type { AskRanaConversationTurn } from "./askRana.types.js";

const EXECUTIVE_PATTERN =
  /\b(healthy|health|approve|approval|submit|submission|concern(?:s|ed)?|worried|worry|what would concern|overall|how (?:is|does) (?:this|the) programme|would you (?:approve|sign|submit)|what do you know confidently|what (?:can|do) you (?:know|confirm) confidently|has (?:the )?programme improved|improved)\b/i;

/**
 * Programme-level / judgment questions that warrant an executive answer shape.
 */
export function isExecutivePlannerQuestion(question: string): boolean {
  return EXECUTIVE_PATTERN.test(question.trim());
}

function recentRanaCorpus(conversation?: AskRanaConversationTurn[]): string {
  if (!conversation?.length) return "";
  return conversation
    .filter((t) => t.role === "rana")
    .slice(-3)
    .map((t) => t.content)
    .join("\n");
}

/**
 * Facts / themes already established in the conversation — for shared-context references.
 */
export function extractEstablishedProgrammeFacts(
  conversation?: AskRanaConversationTurn[]
): string[] {
  const corpus = recentRanaCorpus(conversation);
  if (!corpus) return [];

  const established: string[] = [];

  if (
    /\b0 comparable\b|\bno (?:comparable )?completed projects?\b|\bisn't enough completed\b|\bnot enough completed\b|\blimited (?:historical |completed )?benchmark/i.test(
      corpus
    )
  ) {
    established.push(
      "historical benchmarking is limited (no / insufficient completed-project peers) — refer briefly, do not restate counts"
    );
  }

  if (
    /\b(?:four|4)\s+work packages?\b[\s\S]{0,80}\bincreas/i.test(corpus) ||
    /\bincreas(?:ed|ing)\b[\s\S]{0,80}\b(?:four|4)\s+work packages?\b/i.test(corpus)
  ) {
    established.push(
      "four work packages with increasing remaining work — do not restate the full list unless newly relevant"
    );
  }

  if (/\badditional structural works\b/i.test(corpus)) {
    established.push(
      "Additional Structural Works already discussed — name it at most once more if needed; do not restate +8 unless the question requires it"
    );
  }

  if (/\breinforcement detailing\b/i.test(corpus)) {
    established.push("Reinforcement Detailing already discussed — avoid replaying its full history");
  }

  if (/\breplanning\b/i.test(corpus) && /\bno\b|\bwithout\b|\bnot\b/i.test(corpus)) {
    established.push("absence of replanning already noted — refer as shared context");
  }

  if (
    /\b(?:moderate|early|clear|limited)\s+(?:signs? of )?pressure\b|\bprogramme is (?:showing|under)\b|\boverall assessment\b|\bmy assessment\b/i.test(
      corpus
    )
  ) {
    established.push(
      "an overall health / pressure assessment was already given — build on it; do not restart from scratch"
    );
  }

  if (/\bi would (?:review|compare|confirm|check)\b/i.test(corpus)) {
    established.push("a next-step recommendation was already given — only update it if the new question changes the priority");
  }

  return [...new Set(established)];
}

/**
 * Compress confirmed facts for follow-up turns so the model is not forced to re-narrate the same dump.
 */
export function compressConfirmedFactsForFollowUp(
  facts: string[],
  established: string[],
  isFollowUp: boolean
): string[] {
  if (!isFollowUp || established.length === 0) return facts;

  const limitedBenchmark =
    established.some((e) => /historical benchmarking is limited/i.test(e));
  const aswDiscussed = established.some((e) => /Additional Structural Works already discussed/i.test(e));
  const fourWpDiscussed = established.some((e) => /four work packages with increasing/i.test(e));
  const assessmentGiven = established.some((e) => /overall health \/ pressure assessment/i.test(e));

  const out: string[] = [];
  let addedSharedContext = false;

  for (const fact of facts) {
    const f = fact.trim();
    if (!f) continue;

    if (
      limitedBenchmark &&
      (/comparable completed projects:\s*0/i.test(f) ||
        /no comparable completed/i.test(f) ||
        /no completed-project benchmarks/i.test(f) ||
        /does not yet have enough completed-project history/i.test(f))
    ) {
      if (!addedSharedContext) {
        out.push(
          "Shared context (already discussed): historical benchmarking is limited — do not restate zero-peer counts; say “as discussed, completed-project history is still thin” if needed."
        );
        addedSharedContext = true;
      }
      continue;
    }

    if (fourWpDiscussed && /work packages with increasing remaining work/i.test(f)) {
      continue;
    }

    if (
      aswDiscussed &&
      /additional structural works/i.test(f) &&
      (/\+?\s*8\b|largest remaining/i.test(f) || /Priority \d:/i.test(f))
    ) {
      continue;
    }

    if (assessmentGiven && /^Project Intelligence —/i.test(f)) {
      continue;
    }

    // Cap noisy priority dumps on follow-ups — keep top 2 only once shared context exists
    if (/^Priority \d+:/i.test(f) && assessmentGiven) {
      const priorityNum = Number(f.match(/^Priority (\d+):/i)?.[1] ?? 99);
      if (priorityNum > 2) continue;
    }

    out.push(f);
  }

  if (established.length > 0) {
    out.unshift(
      `Conversation continuity: ${established.slice(0, 4).join("; ")}.`
    );
  }

  return out;
}

/**
 * Deterministic communication guidance for the Planning Director voice.
 */
export function buildPlannerReasoningGuidance(args: {
  question: string;
  isFollowUp: boolean;
  hasDetailedPriorAnswer: boolean;
  establishedFacts: string[];
}): string[] {
  const guidance: string[] = [];
  const executive = isExecutivePlannerQuestion(args.question);

  guidance.push(
    "Voice: experienced Planning Director who has reviewed hundreds of programmes — calm, decisive, practical. Not ChatGPT. Not analytics software."
  );

  guidance.push(
    "ANSWER ORDER (always): (1) Clear professional judgement first. (2) Key reasons synthesised — join related evidence into insight, do not list orphan observations. (3) Brief evidence only where it adds something new. (4) What you would do next. (5) What you know confidently, then any limitation — never open with “I can’t / I don’t know”."
  );

  guidance.push(
    "Language: prefer “From reviewing the programme…”, “My assessment is…”, “I would review…”. Avoid “The revision history shows…”, “There are 0 comparable completed projects”, raw metric dumps, and leading with gaps."
  );

  guidance.push(
    "Insight over observation: if four work packages increased remaining work and there is no replanning, say the pressure is concentrated and the programme appears to be absorbing change without updating planning assumptions — only when those facts are in the knowledge package."
  );

  guidance.push(
    "Repetition within one answer: never name the same work package more than twice; never restate the same metric in two paragraphs; each paragraph must introduce something new."
  );

  if (executive) {
    guidance.push(
      "Executive question detected — use at most five short sections: Overall assessment → Key reasons → Evidence → Recommendation → Confidence / limitations. Keep it tight; lead with the judgement."
    );
  }

  if (args.isFollowUp) {
    guidance.push(
      "Follow-up: do not restart the analysis. Assume shared context. Refer briefly (“As discussed…”, “Building on that…”) instead of re-listing established metrics. Elaborate only on what the new question asks."
    );
  }

  if (args.hasDetailedPriorAnswer) {
    guidance.push(
      "The previous answer was already substantial — add new reasoning or a sharper recommendation; do not regenerate the prior answer."
    );
  }

  if (args.establishedFacts.length > 0) {
    guidance.push(
      `Already established — treat as shared context: ${args.establishedFacts.slice(0, 5).join("; ")}.`
    );
  }

  guidance.push(
    "Close every substantive answer with natural advice that follows the evidence (e.g. which work package to review first, or what to confirm on site) — one clear next step."
  );

  return guidance;
}

/**
 * Soften deficiency-leading phrases in unknowns for the knowledge package.
 */
export function reframeLimitationPhrases(lines: string[]): string[] {
  return lines.map((line) => {
    let s = line.trim();
    if (/^why each planning decision/i.test(s)) {
      return "Planning rationale for each change is not recorded in the programme file.";
    }
    if (/commercial decisions/i.test(s)) {
      return "Commercial decisions, contractor intent, and off-programme factors are outside the imported programme evidence.";
    }
    if (/^i can'?t\b|^i don'?t\b|^unable to\b/i.test(s)) {
      s = s.replace(/^i can'?t\b/i, "Not available in the programme data:")
        .replace(/^i don'?t know\b/i, "Not recorded in the programme:")
        .replace(/^unable to\b/i, "Not available:");
    }
    return s;
  });
}
