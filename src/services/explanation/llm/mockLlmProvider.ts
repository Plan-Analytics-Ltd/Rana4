import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from "./llmProvider.types.js";

const MOCK_EXPLANATION =
  "AI explanation unavailable because no language model provider has been configured. " +
  "Rana4 has prepared the intelligence context and prompt; connect a provider to generate natural-language explanations.";

/** Exercises the pipeline without external API calls. */
export class MockLlmProvider implements LlmProvider {
  readonly id = "mock";
  readonly isConfigured = false;

  async complete(_request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    return {
      status: "not_configured",
      text: MOCK_EXPLANATION,
      message: "AI explanation provider is not configured.",
      providerId: this.id,
    };
  }
}

export const mockLlmProvider = new MockLlmProvider();
