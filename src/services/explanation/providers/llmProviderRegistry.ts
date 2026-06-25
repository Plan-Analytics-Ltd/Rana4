import { getAiExplanationConfig } from "../explanationConfig.js";
import type { LlmProvider } from "./llmProvider.types.js";
import { mockLlmProvider } from "./mockLlmProvider.js";
import { openAiLlmProvider } from "../../integrations/openai/openaiLlmProvider.js";

const providers = new Map<string, LlmProvider>([
  ["mock", mockLlmProvider],
  ["openai", openAiLlmProvider],
]);

/** Register a provider implementation (e.g. OpenAI when added in a future phase). */
export function registerLlmProvider(provider: LlmProvider): void {
  providers.set(provider.id, provider);
}

export function resolveLlmProvider(): LlmProvider {
  const config = getAiExplanationConfig();
  const provider = providers.get(config.provider);
  if (provider) return provider;
  return mockLlmProvider;
}

export function listRegisteredProviderIds(): string[] {
  return [...providers.keys()];
}
