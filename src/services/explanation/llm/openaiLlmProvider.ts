import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider, LlmUsageStats } from "./llmProvider.types.js";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;

const NOT_CONFIGURED_MESSAGE =
  "AI explanations are not available because the OpenAI API key is not configured.";

export type OpenAiFetch = typeof fetch;

export type OpenAiLlmProviderOptions = {
  apiKey?: string;
  fetchImpl?: OpenAiFetch;
  timeoutMs?: number;
};

type OpenAiChatResponse = {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string; code?: string };
};

export function readOpenAiApiKey(): string {
  return String(process.env.OPENAI_API_KEY ?? "").trim();
}

/** Map OpenAI / transport errors to user-safe messages (never expose raw API errors). */
export function mapOpenAiErrorToUserMessage(args: {
  status?: number;
  errorType?: string;
  errorCode?: string;
  isTimeout?: boolean;
  isNetworkError?: boolean;
}): string {
  if (args.isTimeout) {
    return "The AI explanation request timed out. Please try again.";
  }
  if (args.isNetworkError) {
    return "Unable to reach the AI explanation service. Please try again later.";
  }

  const status = args.status ?? 0;
  if (status === 401 || status === 403) {
    return "AI explanations are temporarily unavailable. Please contact your administrator.";
  }
  if (status === 429) {
    if (args.errorCode === "insufficient_quota") {
      return "AI explanations are unavailable because your OpenAI account has no API credits. Please check billing on your OpenAI account.";
    }
    return "AI explanations are temporarily busy. Please try again in a few moments.";
  }
  if (status >= 500) {
    return "The AI explanation service is temporarily unavailable. Please try again later.";
  }
  if (status === 400) {
    return "Unable to generate an explanation with the current request. Please try again.";
  }

  return "Unable to generate an explanation right now. Please try again later.";
}

/** Validate OpenAI chat completion content before returning to callers. */
export function validateOpenAiResponseContent(
  response: OpenAiChatResponse
): { ok: true; text: string } | { ok: false; reason: string } {
  const choice = response.choices?.[0];
  if (!choice) {
    return { ok: false, reason: "empty_choices" };
  }

  const raw = choice.message?.content;
  if (raw == null) {
    return { ok: false, reason: "missing_content" };
  }

  const text = String(raw).trim();
  if (!text) {
    return { ok: false, reason: "empty_content" };
  }

  return { ok: true, text };
}

function usesMaxCompletionTokens(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  );
}

/** Build Chat Completions request body (exported for tests). */
export function buildOpenAiCompletionBody(args: {
  model: string;
  temperature: number;
  maxTokens?: number | null;
  system: string;
  user: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: args.model,
    temperature: args.temperature,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  };

  if (args.maxTokens != null && args.maxTokens > 0) {
    const tokenLimitKey = usesMaxCompletionTokens(args.model) ? "max_completion_tokens" : "max_tokens";
    body[tokenLimitKey] = args.maxTokens;
  }

  return body;
}

function parseUsage(usage: OpenAiChatResponse["usage"]): LlmUsageStats | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

export class OpenAiLlmProvider implements LlmProvider {
  readonly id = "openai";
  private readonly apiKey: string;
  private readonly fetchImpl: OpenAiFetch;
  private readonly timeoutMs: number;

  constructor(options: OpenAiLlmProviderOptions = {}) {
    this.apiKey = options.apiKey ?? readOpenAiApiKey();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (!this.isConfigured) {
      return {
        status: "not_configured",
        text: NOT_CONFIGURED_MESSAGE,
        message: "AI explanation provider is not configured.",
        providerId: this.id,
      };
    }

    const model = String(request.model ?? "").trim();
    if (!model) {
      return {
        status: "error",
        text: null,
        message: "Unable to generate an explanation right now. Please try again later.",
        providerId: this.id,
      };
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildOpenAiCompletionBody({
            model,
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            system: request.system,
            user: request.user,
          })
        ),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      let payload: OpenAiChatResponse;
      try {
        payload = (await response.json()) as OpenAiChatResponse;
      } catch {
        return {
          status: "error",
          text: null,
          message: mapOpenAiErrorToUserMessage({ status: response.status }),
          providerId: this.id,
          model,
          latencyMs,
        };
      }

      if (!response.ok) {
        return {
          status: response.status === 401 || response.status === 403 ? "not_configured" : "error",
          text: null,
          message: mapOpenAiErrorToUserMessage({
            status: response.status,
            errorType: payload.error?.type,
            errorCode: payload.error?.code,
          }),
          providerId: this.id,
          model,
          latencyMs,
          usage: parseUsage(payload.usage),
        };
      }

      const validated = validateOpenAiResponseContent(payload);
      if (!validated.ok) {
        return {
          status: "error",
          text: null,
          message: "The AI explanation service returned an empty response. Please try again.",
          providerId: this.id,
          model,
          latencyMs,
          usage: parseUsage(payload.usage),
        };
      }

      return {
        status: "success",
        text: validated.text,
        providerId: this.id,
        model,
        latencyMs,
        usage: parseUsage(payload.usage),
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const isAbort = err instanceof Error && err.name === "AbortError";
      const isNetwork =
        err instanceof TypeError ||
        (err instanceof Error && /fetch|network|ECONNREFUSED|ENOTFOUND/i.test(err.message));

      return {
        status: "error",
        text: null,
        message: mapOpenAiErrorToUserMessage({
          isTimeout: isAbort,
          isNetworkError: isNetwork,
        }),
        providerId: this.id,
        model,
        latencyMs,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const openAiLlmProvider = new OpenAiLlmProvider();

export function createOpenAiLlmProvider(options?: OpenAiLlmProviderOptions): OpenAiLlmProvider {
  return new OpenAiLlmProvider(options);
}
