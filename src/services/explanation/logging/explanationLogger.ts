import type { ExplanationType } from "../types/explanationTypes.js";

export type ExplanationLogEvent =
  | "context_built"
  | "validation_completed"
  | "prompt_built"
  | "provider_selected"
  | "provider_skipped"
  | "provider_success"
  | "provider_error"
  | "explanation_disabled";

type LogPayload = {
  explanationType: ExplanationType;
  projectId: string;
  deliverableId: string;
  providerId?: string;
  model?: string;
  latencyMs?: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  error?: string;
  readiness?: string;
  validationScore?: number;
  failedCheckCount?: number;
  providerCalled?: boolean;
};

/** Structured, non-sensitive logging for the explanation pipeline. */
export function logExplanationEvent(event: ExplanationLogEvent, payload: LogPayload): void {
  const base = {
    event: `explanation.${event}`,
    explanationType: payload.explanationType,
    projectId: payload.projectId,
    deliverableId: payload.deliverableId,
    ...(payload.providerId ? { providerId: payload.providerId } : {}),
    ...(payload.model ? { model: payload.model } : {}),
    ...(payload.latencyMs != null ? { latencyMs: payload.latencyMs } : {}),
    ...(payload.usage ? { usage: payload.usage } : {}),
    ...(payload.error ? { error: payload.error } : {}),
    ...(payload.readiness ? { readiness: payload.readiness } : {}),
    ...(payload.validationScore != null ? { validationScore: payload.validationScore } : {}),
    ...(payload.failedCheckCount != null ? { failedCheckCount: payload.failedCheckCount } : {}),
    ...(payload.providerCalled != null ? { providerCalled: payload.providerCalled } : {}),
  };
  if (event === "provider_error") {
    console.error("[explanation]", base);
    return;
  }
  console.info("[explanation]", base);
}
