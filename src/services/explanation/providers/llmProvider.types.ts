export type LlmUsageStats = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LlmCompletionRequest = {
  system: string;
  user: string;
  model: string;
  temperature: number;
  /** Omit or set null to let the provider use its model default (no cap). */
  maxTokens?: number | null;
};

export type LlmCompletionResult = {
  status: "success" | "not_configured" | "mock" | "error";
  text: string | null;
  message?: string;
  providerId: string;
  model?: string;
  latencyMs?: number;
  usage?: LlmUsageStats;
};

/** Provider-agnostic interface — OpenAI or others implement this later. */
export interface LlmProvider {
  readonly id: string;
  readonly isConfigured: boolean;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

export type LlmProviderFactory = () => LlmProvider;
