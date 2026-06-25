import {
  buildExplanationIntelligencePackage,
  buildContextSummary,
  type ExplanationIntelligencePackage,
} from "./explanationContext.builder.js";
import { getAiExplanationConfig, resolveSystemPrompt } from "./explanationConfig.js";
import { buildExplanationSources, flattenSupportingEvidence } from "./explanationCitations.js";
import { logExplanationEvent } from "./explanationLogger.js";
import { buildExplanationPrompt } from "./explanationPrompt.builder.js";
import type {
  ExplanationRequest,
  ExplanationResult,
  ExplanationType,
  ExplanationValidationReport,
} from "./explanationTypes.js";
import { parseExplanationType } from "./explanationTypes.js";
import {
  NOT_READY_EXPLANATION_MESSAGE,
  shouldInvokeExplanationProvider,
  validateExplanationContext,
} from "./explanationValidator.service.js";
import { resolveLlmProvider } from "./llm/llmProviderRegistry.js";

export function parseExplanationRequestBody(body: unknown): {
  deliverableId: string;
  explanationType: ExplanationType;
  question: string | null;
} | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const deliverableId = String(b.deliverableId ?? "").trim();
  const explanationType = parseExplanationType(b.explanationType);
  if (!deliverableId || !explanationType) return null;
  const questionRaw = b.question;
  const question =
    questionRaw == null || String(questionRaw).trim() === "" ? null : String(questionRaw).trim();
  return { deliverableId, explanationType, question };
}

export async function validateDeliverableExplanation(
  request: Omit<ExplanationRequest, "question">
): Promise<{ validation: ExplanationValidationReport; contextSummary: ReturnType<typeof buildContextSummary> }> {
  const intelligencePackage = await buildExplanationIntelligencePackage({
    projectId: request.projectId,
    companyId: request.companyId,
    deliverableId: request.deliverableId,
    selectedProjectIds: request.selectedProjectIds,
  });

  const validation = validateExplanationContext(intelligencePackage, request.explanationType);

  logExplanationEvent("validation_completed", {
    explanationType: request.explanationType,
    projectId: request.projectId,
    deliverableId: request.deliverableId,
    readiness: validation.readiness,
    validationScore: validation.score,
    failedCheckCount: validation.failedChecks.length,
    providerCalled: false,
  });

  return {
    validation,
    contextSummary: buildContextSummary(intelligencePackage),
  };
}

function buildResultBase(args: {
  request: ExplanationRequest;
  intelligencePackage: ExplanationIntelligencePackage;
  validation: ExplanationValidationReport;
  question: string | null;
  generatedPrompt: { system: string; user: string };
  providerCalled: boolean;
  providerId?: string;
}): Omit<ExplanationResult, "status" | "explanation" | "message"> {
  const citations = args.intelligencePackage.citationChain;
  const sources = buildExplanationSources(citations);
  const contextSummary = buildContextSummary(args.intelligencePackage);
  const supportingEvidence = flattenSupportingEvidence({
    deliverable: args.intelligencePackage.deliverable,
    currentDurationDays: args.intelligencePackage.currentDurationDays,
    benchmark: args.intelligencePackage.benchmark,
    outlier: args.intelligencePackage.outlier,
    evidence: args.intelligencePackage.evidence,
    observations: args.intelligencePackage.observations,
    keyFactors: args.intelligencePackage.keyFactors,
    reliability: args.intelligencePackage.forecastReliability,
    predictedOutcome: args.intelligencePackage.outcomePrediction,
    recommendations: args.intelligencePackage.recommendations,
    trust: args.intelligencePackage.trust,
  });
  const confidence =
    args.intelligencePackage.trust?.trustBand ??
    args.intelligencePackage.benchmark?.confidenceLevel ??
    null;

  return {
    explanationType: args.request.explanationType,
    question: args.question,
    confidence,
    citations,
    sources,
    supportingEvidence,
    generatedPrompt: args.generatedPrompt,
    contextSummary,
    validation: args.validation,
    providerCalled: args.providerCalled,
    providerId: args.providerId,
  };
}

export async function generateDeliverableExplanation(
  request: ExplanationRequest
): Promise<ExplanationResult> {
  const config = getAiExplanationConfig();
  const question = request.question ?? null;

  if (!config.enabled) {
    logExplanationEvent("explanation_disabled", {
      explanationType: request.explanationType,
      projectId: request.projectId,
      deliverableId: request.deliverableId,
    });
  }

  const intelligencePackage = await buildExplanationIntelligencePackage({
    projectId: request.projectId,
    companyId: request.companyId,
    deliverableId: request.deliverableId,
    selectedProjectIds: request.selectedProjectIds,
  });

  logExplanationEvent("context_built", {
    explanationType: request.explanationType,
    projectId: request.projectId,
    deliverableId: request.deliverableId,
  });

  const validation = validateExplanationContext(intelligencePackage, request.explanationType);

  logExplanationEvent("validation_completed", {
    explanationType: request.explanationType,
    projectId: request.projectId,
    deliverableId: request.deliverableId,
    readiness: validation.readiness,
    validationScore: validation.score,
    failedCheckCount: validation.failedChecks.length,
    providerCalled: false,
  });

  const emptyPrompt = { system: "", user: "" };

  if (!shouldInvokeExplanationProvider(validation.readiness)) {
    logExplanationEvent("provider_skipped", {
      explanationType: request.explanationType,
      projectId: request.projectId,
      deliverableId: request.deliverableId,
      readiness: validation.readiness,
      validationScore: validation.score,
      failedCheckCount: validation.failedChecks.length,
      providerCalled: false,
    });

    return {
      ...buildResultBase({
        request,
        intelligencePackage,
        validation,
        question,
        generatedPrompt: emptyPrompt,
        providerCalled: false,
      }),
      status: "not_ready",
      explanation: NOT_READY_EXPLANATION_MESSAGE,
      message: NOT_READY_EXPLANATION_MESSAGE,
    };
  }

  const systemPrompt = resolveSystemPrompt(config);
  const validationWarnings =
    validation.readiness === "LIMITED" ? validation.issues : undefined;
  const generatedPrompt = buildExplanationPrompt({
    systemPrompt,
    explanationType: request.explanationType,
    question,
    intelligencePackage,
    validationWarnings,
  });

  logExplanationEvent("prompt_built", {
    explanationType: request.explanationType,
    projectId: request.projectId,
    deliverableId: request.deliverableId,
  });

  const provider = resolveLlmProvider();
  logExplanationEvent("provider_selected", {
    explanationType: request.explanationType,
    projectId: request.projectId,
    deliverableId: request.deliverableId,
    providerId: provider.id,
    model: config.model,
    readiness: validation.readiness,
    validationScore: validation.score,
    providerCalled: true,
  });

  const base = buildResultBase({
    request,
    intelligencePackage,
    validation,
    question,
    generatedPrompt: config.includeGeneratedPromptInResponse
      ? generatedPrompt
      : { system: "[redacted]", user: "[redacted]" },
    providerCalled: true,
    providerId: provider.id,
  });

  let resultStatus: ExplanationResult["status"] = "mock";
  let explanation: string | null = null;
  let message: string | undefined;

  try {
    const completion = await provider.complete({
      system: generatedPrompt.system,
      user: generatedPrompt.user,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });

    if (completion.status === "success") {
      resultStatus = config.enabled ? "success" : "mock";
      explanation = completion.text;
      logExplanationEvent("provider_success", {
        explanationType: request.explanationType,
        projectId: request.projectId,
        deliverableId: request.deliverableId,
        providerId: completion.providerId,
        model: completion.model ?? config.model,
        latencyMs: completion.latencyMs,
        usage: completion.usage,
        readiness: validation.readiness,
        validationScore: validation.score,
        providerCalled: true,
      });
    } else if (completion.status === "not_configured") {
      resultStatus = "provider_not_configured";
      explanation = completion.text;
      message = completion.message ?? "AI explanation provider is not configured.";
      logExplanationEvent("provider_error", {
        explanationType: request.explanationType,
        projectId: request.projectId,
        deliverableId: request.deliverableId,
        providerId: completion.providerId,
        model: completion.model ?? config.model,
        latencyMs: completion.latencyMs,
        error: message,
        readiness: validation.readiness,
        validationScore: validation.score,
        providerCalled: true,
      });
    } else {
      resultStatus = "error";
      message = completion.message ?? "Explanation provider failed.";
      logExplanationEvent("provider_error", {
        explanationType: request.explanationType,
        projectId: request.projectId,
        deliverableId: request.deliverableId,
        providerId: completion.providerId,
        model: completion.model ?? config.model,
        latencyMs: completion.latencyMs,
        usage: completion.usage,
        error: message,
        readiness: validation.readiness,
        validationScore: validation.score,
        providerCalled: true,
      });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Explanation provider failed.";
    resultStatus = "error";
    message = errMsg;
    logExplanationEvent("provider_error", {
      explanationType: request.explanationType,
      projectId: request.projectId,
      deliverableId: request.deliverableId,
      providerId: provider.id,
      error: errMsg,
      providerCalled: true,
    });
  }

  if (!config.enabled && resultStatus !== "error") {
    resultStatus = "disabled";
    message = message ?? "AI explanations are not enabled for this environment.";
  }

  return {
    ...base,
    status: resultStatus,
    explanation,
    message,
  };
}
