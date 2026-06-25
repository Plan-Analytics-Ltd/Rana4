import type { ExplanationIntelligencePackage } from "./explanationContext.builder.js";
import type { ExplanationType } from "./explanationTypes.js";
import {
  buildLlmBriefingContext,
  EXPLANATION_TYPE_PLANNER_LABELS,
} from "./explanationPromptSanitizer.js";

/** Default system prompt for Rana4's explanation assistant (provider-agnostic). */
export const DEFAULT_SYSTEM_PROMPT = `You are Rana4's planning explanation assistant.

You do not invent facts.
You do not estimate durations.
You do not generate new recommendations.
You only explain the intelligence already produced by Rana4.

Every explanation must remain consistent with:
- Benchmark
- Observations
- Key Factors
- Forecast Reliability
- Outcome Prediction
- Recommendations
- Trust

If evidence is weak, explicitly state that.
Never fabricate statistics.
Never claim information that is not present in the supplied context.

Use simple language suitable for project managers, planners, and clients.
Reference supporting evidence from the context when explaining conclusions.`;

export type BuiltExplanationPrompt = {
  system: string;
  user: string;
};

const TEMPLATE_INSTRUCTIONS: Record<ExplanationType, string> = {
  FLAGGED_DELIVERABLE:
    "Explain why this deliverable is flagged (or not flagged) based on the outlier analysis, benchmark, and observations. Do not suggest new durations.",
  RECOMMENDATION:
    "Explain the recommendations already generated for this deliverable. Reference severity, confidence, and supporting evidence only from the context.",
  PREDICTED_OUTCOME:
    "Explain the predicted outcome range and reasoning chain. Do not produce a new prediction.",
  BENCHMARK:
    "Explain how this deliverable compares to historical benchmarks, including sample size and confidence limitations.",
  FORECAST_RELIABILITY:
    "Explain forecast reliability based on historical planned-vs-actual behaviour. State overrun frequency and variance only if present in context.",
  TRUST_SCORE:
    "Explain the trust score and band, including evidence strength and knowledge coverage. Reference the trust explanation fields only.",
  KEY_FACTORS:
    "Explain the key factors (drivers) affecting this deliverable's duration outlook. Do not invent new drivers.",
  DELIVERABLE_SUMMARY:
    "Provide a concise summary of all intelligence layers for this deliverable in plain language for a project manager.",
};

export function buildExplanationPrompt(args: {
  systemPrompt: string;
  explanationType: ExplanationType;
  question: string | null;
  intelligencePackage: ExplanationIntelligencePackage;
  validationWarnings?: string[];
}): BuiltExplanationPrompt {
  const typeInstruction = TEMPLATE_INSTRUCTIONS[args.explanationType];
  const typeLabel = EXPLANATION_TYPE_PLANNER_LABELS[args.explanationType];
  const userQuestion = args.question?.trim()
    ? `User question: ${args.question.trim()}`
    : "User question: (none — use the template focus below)";

  const validationBlock =
    args.validationWarnings && args.validationWarnings.length > 0
      ? [
          "Validation warnings (must be reflected in the explanation):",
          ...args.validationWarnings.map((w) => `- ${w}`),
          "",
        ].join("\n")
      : "";

  const briefing = buildLlmBriefingContext(args.intelligencePackage);

  const user = [
    `Explanation focus: ${typeLabel}`,
    userQuestion,
    "",
    validationBlock,
    "Task:",
    typeInstruction,
    "",
    "Planning intelligence briefing (source of truth — do not go beyond this):",
    briefing,
  ].join("\n");

  return {
    system: args.systemPrompt,
    user,
  };
}
