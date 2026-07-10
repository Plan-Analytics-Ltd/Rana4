import { getAiExplanationConfig } from "../explanation/explanationConfig.js";
import { ASK_RANA_SYSTEM_PROMPT } from "./askRanaPrompt.builder.js";
import { buildAskRanaEvidencePackage } from "./askRanaContextBuilder.service.js";
import { buildAskRanaPrompt } from "./askRanaPrompt.builder.js";
import { buildAskRanaKnowledgePackage } from "./askRanaKnowledgePackage.service.js";
import { loadingHintForDomains } from "./askRanaEvidenceSelector.js";
import { resolveEvidenceDomains } from "./askRanaEvidenceScopeResolver.service.js";
import { interpretPlannerQuery } from "./askRanaPlannerQueryInterpreter.service.js";
import { verifyPlannerQuestion } from "./askRanaQuestionVerification.service.js";
import { buildPlannerInvestigation } from "./askRanaInvestigation.service.js";
import { classifyPlannerResponseDepth } from "./askRanaResponseDepth.service.js";
import type { AskRanaVerificationResult } from "./askRanaQuestionVerification.service.js";
import type { AskRanaResponseStyle } from "./askRanaQuestionVerification.service.js";
import { resolveLlmProvider } from "../explanation/providers/llmProviderRegistry.js";
import type { AskRanaConversationTurn, AskRanaEvidencePackage, AskRanaRequest, AskRanaResult } from "./askRana.types.js";
import {
  buildEvolutionFactsForAnswer,
  buildPartialComparisonAnswer,
  hasEvolutionWithoutComparison,
  hasSubstantiveEvidence,
} from "./askRanaPartialEvidence.service.js";

export function parseAskRanaRequestBody(body: unknown): {
  deliverableId: string | null;
  question: string;
  conversation: AskRanaConversationTurn[];
  pageContext: string | null;
} | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const deliverableId = String(b.deliverableId ?? "").trim() || null;
  const question = String(b.question ?? "").trim();
  const pageContext = String(b.pageContext ?? "").trim() || null;
  if (!question) return null;

  const conversation: AskRanaConversationTurn[] = [];
  if (Array.isArray(b.conversation)) {
    for (const turn of b.conversation) {
      if (!turn || typeof turn !== "object") continue;
      const t = turn as Record<string, unknown>;
      const role = t.role === "rana" ? "rana" : t.role === "planner" ? "planner" : null;
      const content = String(t.content ?? "").trim();
      if (role && content) conversation.push({ role, content });
    }
  }

  return { deliverableId, question, conversation, pageContext };
}

function parseSelectedProjectIds(body: unknown): string[] | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = (body as Record<string, unknown>).projectIds;
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.map((id) => String(id).trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function formatFallbackAnswer(parts: string[], style: AskRanaResponseStyle): string {
  if (parts.length === 0) return "";
  if (style === "brief" || parts.length === 1) {
    return parts.join(" ");
  }

  const [summary, ...rest] = parts;
  const sections = [`### Summary\n\n${summary}`];

  if (rest.length === 1) {
    sections.push(rest[0]!);
  } else if (rest.length > 1) {
    const limitation = rest[rest.length - 1]!;
    const evidence = rest.slice(0, -1);
    if (evidence.length > 0) {
      sections.push(`### Evidence\n\n${evidence.map((p) => `- ${p}`).join("\n")}`);
    }
    if (/can't yet judge|not configured|comparison/i.test(limitation)) {
      sections.push(limitation.startsWith("###") ? limitation : `### Note\n\n${limitation}`);
    } else {
      sections.push(limitation);
    }
  }

  return sections.join("\n\n");
}

/** Deterministic fallback when LLM is unavailable — still evidence-only, no invented facts. */
function buildDeterministicFallbackAnswer(
  question: string,
  evidencePackage: AskRanaEvidencePackage,
  verification: AskRanaVerificationResult
): string {
  const parts: string[] = [];
  const q = question.toLowerCase();

  if (verification.corrections.length > 0) {
    const e = evidencePackage.projectEvolution;
    if (e?.baselineDays != null && e.latestDays != null) {
      const dir =
        e.netChangeDays != null && e.netChangeDays < 0
          ? "reduced"
          : e.netChangeDays != null && e.netChangeDays > 0
            ? "increased"
            : "changed";
      parts.push(
        `The available evidence doesn't show what you described — it actually shows duration ${dir} from ${e.baselineDays} to ${e.latestDays} days.`
      );
    }
  }

  if (verification.topic === "out_of_scope_plant") {
    return `${parts.join(" ")}${parts.length ? " " : ""}I can't confirm that — the imported programme doesn't include plant or equipment information.`.trim() +
      "\n\n(AI assistant is not configured — this is a brief evidence summary only.)";
  }

  if (verification.topic === "out_of_scope_people") {
    return `${parts.join(" ")}${parts.length ? " " : ""}The imported evidence doesn't include designer, subcontractor, or responsibility information, so I can't determine that.`.trim() +
      "\n\n(AI assistant is not configured — this is a brief evidence summary only.)";
  }

  if (evidencePackage.projectEvolution?.available) {
    const e = evidencePackage.projectEvolution;
    if (/\b(why|change|revision|history|evolution|stable|reduce|increase)\b/.test(q)) {
      if (verification.isFollowUp && verification.doNotRepeat.length > 0) {
        if (/\bwhy\b/.test(q) && e.plannerObservations.length) {
          parts.push(e.plannerObservations[0]!);
        }
      } else {
        if (e.howChangedSummary) parts.push(e.howChangedSummary);
        else if (e.summary) parts.push(e.summary);
        if (/\bwhy\b/.test(q) && e.plannerObservations.length) {
          parts.push(e.plannerObservations[0]!);
        }
      }
    }
  }

  if (evidencePackage.previousProjects?.available) {
    const p = evidencePackage.previousProjects;
    if (/\b(reasonable|normal|realistic|compare|worry|should i increase|should i reduce|typical)\b/.test(q)) {
      if (p.comparisonAssessment) parts.push(p.comparisonAssessment);
      if (p.typicalRangeLabel && p.currentDurationDays != null) {
        parts.push(
          `Your plan is ${p.currentDurationDays} days. Similar work on completed projects usually sits around ${p.typicalRangeLabel.toLowerCase()}.`
        );
      }
    }
  } else if (
    verification.topic === "comparison" &&
    hasEvolutionWithoutComparison(evidencePackage) &&
    /\b(reasonable|normal|realistic|compare|worry|should i increase|should i reduce|typical|duration)\b/.test(q)
  ) {
    parts.push(...buildPartialComparisonAnswer(evidencePackage));
  }

  if (parts.length === 0) {
    if (evidencePackage.projectEvolution?.summary && verification.topic === "evolution") {
      parts.push(evidencePackage.projectEvolution.summary);
    } else if (evidencePackage.previousProjects?.comparisonAssessment && verification.topic === "comparison") {
      parts.push(evidencePackage.previousProjects.comparisonAssessment);
    } else if (verification.topic === "comparison" && hasEvolutionWithoutComparison(evidencePackage)) {
      parts.push(...buildPartialComparisonAnswer(evidencePackage));
    }
  }

  if (
    verification.relevantMissingEvidence.length > 0 &&
    verification.responseStyle !== "brief" &&
    !(verification.topic === "comparison" && hasEvolutionWithoutComparison(evidencePackage))
  ) {
    if (parts.length === 0) {
      parts.push(verification.relevantMissingEvidence[0]!);
    }
  } else if (
    verification.relevantMissingEvidence.length > 0 &&
    parts.length === 0 &&
    !(verification.topic === "comparison" && hasEvolutionWithoutComparison(evidencePackage))
  ) {
    parts.push(verification.relevantMissingEvidence[0]!);
  }

  if (parts.length === 0) {
    if (hasSubstantiveEvidence(evidencePackage)) {
      const facts = buildEvolutionFactsForAnswer(evidencePackage);
      if (facts.length > 0) parts.push(...facts);
    }
  }

  if (parts.length === 0) {
    return "I don't have enough evidence loaded to answer that yet. Import completed projects and programme updates so I can help.";
  }

  const suffix =
    verification.responseStyle === "brief"
      ? "\n\n(AI assistant is not configured.)"
      : "\n\n(AI assistant is not configured — this is a brief evidence summary only.)";
  return `${formatFallbackAnswer(parts, verification.responseStyle)}${suffix}`;
}

export function getAskRanaLoadingHint(question: string, pageContext?: string | null): string {
  const plannerQuery = interpretPlannerQuery(question, { pageContext });
  const domains = resolveEvidenceDomains(plannerQuery, question);
  return loadingHintForDomains(domains);
}

export async function askRana(request: AskRanaRequest): Promise<AskRanaResult> {
  const config = getAiExplanationConfig();
  const plannerQuery = interpretPlannerQuery(request.question, { pageContext: request.pageContext });
  const evidencePackage = await buildAskRanaEvidencePackage(request, plannerQuery);
  const sources = evidencePackage.sources;

  if (!hasSubstantiveEvidence(evidencePackage) && evidencePackage.evidenceGaps.length > 0) {
    return {
      status: "not_ready",
      answer:
        "I don't have enough evidence loaded to answer that yet. " +
        evidencePackage.evidenceGaps.slice(0, 2).join(" "),
      sources,
      plannerQuery,
      providerCalled: false,
    };
  }

  const responseDepth = classifyPlannerResponseDepth({
    question: request.question,
    plannerQuery,
    conversation: request.conversation,
  });

  const verification = verifyPlannerQuestion({
    question: request.question,
    evidencePackage,
    conversation: request.conversation,
    plannerQuery,
    responseDepth: responseDepth.depth,
  });

  const investigation = buildPlannerInvestigation({
    question: request.question,
    evidencePackage,
    plannerQuery,
    conversation: request.conversation,
    depth: responseDepth.depth,
    followUpIntent: responseDepth.followUpIntent,
  });

  const knowledge = buildAskRanaKnowledgePackage({
    evidencePackage,
    plannerQuery,
    verification,
    responseDepth,
    investigation,
  });

  const systemPrompt = config.systemPromptOverride
    ? `${ASK_RANA_SYSTEM_PROMPT}\n\n${config.systemPromptOverride}`
    : ASK_RANA_SYSTEM_PROMPT;

  const prompt = buildAskRanaPrompt({
    question: request.question,
    knowledge,
    conversation: request.conversation,
    systemPrompt,
  });

  const provider = resolveLlmProvider();

  if (!config.enabled || provider.id === "mock" || !provider.isConfigured) {
    return {
      status: config.enabled ? "provider_not_configured" : "disabled",
      answer: buildDeterministicFallbackAnswer(request.question, evidencePackage, verification),
      message: config.enabled
        ? "AI assistant is not configured. Showing evidence summary only."
        : "AI assistant is disabled for this environment.",
      sources,
      plannerQuery,
      providerCalled: false,
      providerId: provider.id,
    };
  }

  try {
    const completion = await provider.complete({
      system: prompt.system,
      user: prompt.user,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });

    if (completion.status === "success" && completion.text) {
      return {
        status: "success",
        answer: completion.text.trim(),
        sources,
        plannerQuery,
        providerCalled: true,
        providerId: completion.providerId,
      };
    }

    return {
      status: completion.status === "not_configured" ? "provider_not_configured" : "error",
      answer: buildDeterministicFallbackAnswer(request.question, evidencePackage, verification),
      message: completion.message ?? "Rana could not generate a response.",
      sources,
      plannerQuery,
      providerCalled: true,
      providerId: completion.providerId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ask Rana request failed.";
    return {
      status: "error",
      answer: buildDeterministicFallbackAnswer(request.question, evidencePackage, verification),
      message,
      sources,
      plannerQuery,
      providerCalled: true,
    };
  }
}

export { parseSelectedProjectIds };
