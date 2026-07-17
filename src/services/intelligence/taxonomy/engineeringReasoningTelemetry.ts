/**
 * In-memory telemetry for Engineering reasoning decisions.
 *
 * Every identity resolution leaves an evidence trail here (developer-only, never
 * shown to planners). It is a bounded ring buffer — it evaporates on restart and
 * never touches the database, so it is safe to record on the hot path. The
 * diagnostics service reads it to answer "what has the brain been doing lately?".
 */
import type { LlmUsageStats } from "../../explanation/providers/llmProvider.types.js";

export type EngineeringReasoningEvent = {
  deliverableName: string;
  fragnetName: string | null;
  source: "RULE_BASED" | "LLM_REASONED" | "LLM_MERGED";
  status: "RESOLVED" | "INSUFFICIENT";
  confidence: string;
  disciplineId: string | null;
  engineeringObjectId: string | null;
  engineeringWorkId: string | null;
  validationValid: boolean;
  overrides: string[];
  durationMs: number;
  at: number;
  usage?: LlmUsageStats;
};

const MAX_EVENTS = 1000;
const buffer: EngineeringReasoningEvent[] = [];

export function recordEngineeringReasoningEvent(event: EngineeringReasoningEvent): void {
  buffer.push(event);
  if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
}

export function getRecentEngineeringReasoningEvents(limit = 200): EngineeringReasoningEvent[] {
  const start = Math.max(0, buffer.length - limit);
  return buffer.slice(start).reverse();
}

export function getEngineeringReasoningEventCount(): number {
  return buffer.length;
}

export function clearEngineeringReasoningTelemetry(): void {
  buffer.length = 0;
}

export function summarizeEngineeringReasoningEvents(
  events: EngineeringReasoningEvent[]
): {
  totalCalls: number;
  llmCalls: number;
  ruleBasedCalls: number;
  totalDurationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  let llmCalls = 0;
  let ruleBasedCalls = 0;
  let totalDurationMs = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  for (const event of events) {
    totalDurationMs += event.durationMs;
    if (event.source === "RULE_BASED") ruleBasedCalls += 1;
    else llmCalls += 1;
    promptTokens += event.usage?.promptTokens ?? 0;
    completionTokens += event.usage?.completionTokens ?? 0;
    totalTokens += event.usage?.totalTokens ?? 0;
  }
  return {
    totalCalls: events.length,
    llmCalls,
    ruleBasedCalls,
    totalDurationMs,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}
