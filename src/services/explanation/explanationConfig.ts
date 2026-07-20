import { DEFAULT_SYSTEM_PROMPT } from "./prompt/explanationPrompt.builder.js";

export type AiExplanationConfig = {
  enabled: boolean;
  provider: string;
  model: string;
  temperature: number;
  /** When null, no max_tokens cap is sent to the provider (model default applies). */
  maxTokens: number | null;
  systemPromptOverride: string | null;
  includeGeneratedPromptInResponse: boolean;
};

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null || value.trim() === "") return defaultValue;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value == null || value.trim() === "") return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

/** null = no cap. Unset env, 0, "none", or "unlimited" all mean no cap. */
function parseOptionalMaxTokens(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "0" || normalized === "none" || normalized === "unlimited" || normalized === "off") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Read AI explanation configuration from environment. */
export function getAiExplanationConfig(): AiExplanationConfig {
  const provider = String(process.env.AI_EXPLANATION_PROVIDER ?? "mock").trim().toLowerCase() || "mock";
  const enabled = parseBool(process.env.AI_EXPLANATION_ENABLED, false);
  const override = String(process.env.AI_SYSTEM_PROMPT_OVERRIDE ?? "").trim();

  return {
    enabled,
    provider,
    model: String(process.env.AI_EXPLANATION_MODEL ?? "").trim() || "gpt-4.1-mini",
    temperature: parseNumber(process.env.AI_EXPLANATION_TEMPERATURE, 0.2),
    maxTokens: parseOptionalMaxTokens(process.env.AI_EXPLANATION_MAX_TOKENS),
    systemPromptOverride: override.length > 0 ? override : null,
    includeGeneratedPromptInResponse: parseBool(process.env.AI_EXPLANATION_DEBUG_PROMPTS, false),
  };
}

export function resolveSystemPrompt(config: AiExplanationConfig): string {
  return config.systemPromptOverride ?? DEFAULT_SYSTEM_PROMPT;
}
