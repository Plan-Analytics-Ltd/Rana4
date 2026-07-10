import type { AskRanaKnowledgePackage } from "./askRanaKnowledgePackage.types.js";

function section(title: string, items: string[]): string | null {
  if (items.length === 0) return null;
  return `## ${title}\n${items.map((i) => `- ${i}`).join("\n")}`;
}

/** Serialize deterministic knowledge for the LLM user prompt. */
export function serializeKnowledgePackageForPrompt(knowledge: AskRanaKnowledgePackage): string {
  const parts: string[] = [];

  if (knowledge.factualCorrections.length > 0) {
    parts.push(
      section(
        "Factual corrections (planner assumptions that contradict the evidence)",
        knowledge.factualCorrections
      )!
    );
  }

  parts.push(
    [
      "## Planner context",
      `- Intent: ${knowledge.plannerContext.intent}`,
      `- Evidence scope: ${knowledge.plannerContext.evidenceScope}`,
      `- Entity: ${knowledge.plannerContext.entity}`,
      knowledge.plannerContext.qualifiers.length > 0
        ? `- Qualifiers: ${knowledge.plannerContext.qualifiers.join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n")
  );

  parts.push(
    [
      "## Conversation context",
      `- Planner expectation: ${knowledge.conversationContext.plannerExpectation}`,
      knowledge.conversationContext.newInformationRequested
        ? `- New information requested: ${knowledge.conversationContext.newInformationRequested}`
        : null,
      knowledge.conversationContext.topicsAlreadyExplained.length > 0
        ? `- Already explained: ${knowledge.conversationContext.topicsAlreadyExplained.join("; ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n")
  );

  const confirmed = section("Confirmed facts", knowledge.confirmedFacts);
  if (confirmed) parts.push(confirmed);

  if (knowledge.investigationFindings?.strongestConclusion) {
    parts.push(
      `## Strongest supported conclusion\n- ${knowledge.investigationFindings.strongestConclusion}`
    );
  }

  const supported = section("Supported conclusions", knowledge.supportedConclusions);
  if (supported) parts.push(supported);

  const ruledOut = section("Ruled-out explanations", knowledge.ruledOutExplanations);
  if (ruledOut) parts.push(ruledOut);

  const alternatives = section("Alternative explanations (possible, not confirmed)", knowledge.alternativeExplanations);
  if (alternatives) parts.push(alternatives);

  if (knowledge.investigationFindings?.evidenceLinks.length) {
    parts.push(section("Evidence links", knowledge.investigationFindings.evidenceLinks)!);
  }

  const unknowns = section("Unknowns (not recorded in the imported programme)", knowledge.unknowns);
  if (unknowns) parts.push(unknowns);

  if (knowledge.evidenceNotes.length > 0) {
    parts.push(section("Evidence notes", knowledge.evidenceNotes)!);
  }

  if (knowledge.comparisonContext.length > 0) {
    parts.push(section("Previous project comparison", knowledge.comparisonContext)!);
  }

  if (knowledge.recommendations.length > 0) {
    parts.push(section("Existing recommendations", knowledge.recommendations)!);
  }

  return parts.filter(Boolean).join("\n\n");
}
