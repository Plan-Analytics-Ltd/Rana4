/**
 * OpenAI LLM provider unit checks (no live API calls).
 * Run: npm run test:explanation-openai
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createOpenAiLlmProvider,
  mapOpenAiErrorToUserMessage,
  validateOpenAiResponseContent,
} from "../../dist/services/integrations/openai/openaiLlmProvider.js";
import {
  shouldInvokeExplanationProvider,
  validateExplanationContext,
} from "../../dist/services/explanation/validation/explanationValidator.service.js";

const sampleRequest = {
  system: "You explain planning intelligence.",
  user: "Explain the benchmark for Design Review.",
  model: "gpt-4.1-mini",
  temperature: 0.2,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("missing API key returns not_configured without calling fetch", async () => {
  let fetchCalled = false;
  const provider = createOpenAiLlmProvider({
    apiKey: "",
    fetchImpl: async () => {
      fetchCalled = true;
      return jsonResponse({});
    },
  });

  assert.equal(provider.isConfigured, false);
  const result = await provider.complete(sampleRequest);
  assert.equal(result.status, "not_configured");
  assert.equal(fetchCalled, false);
  assert.ok(result.text?.includes("API key"));
});

test("invalid API key (401) returns friendly message without raw OpenAI error", async () => {
  const provider = createOpenAiLlmProvider({
    apiKey: "sk-invalid",
    fetchImpl: async () =>
      jsonResponse({ error: { message: "Incorrect API key provided: sk-invalid", type: "invalid_request_error" } }, 401),
  });

  const result = await provider.complete(sampleRequest);
  assert.equal(result.status, "not_configured");
  assert.ok(result.message);
  assert.equal(result.message.includes("sk-invalid"), false);
  assert.equal(result.message.includes("Incorrect API key"), false);
});

test("insufficient quota (429) returns billing message", async () => {
  const provider = createOpenAiLlmProvider({
    apiKey: "sk-test",
    fetchImpl: async () =>
      jsonResponse({ error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } }, 429),
  });

  const result = await provider.complete(sampleRequest);
  assert.equal(result.status, "error");
  assert.ok(result.message?.toLowerCase().includes("credits") || result.message?.toLowerCase().includes("billing"));
});

test("rate limit (429) returns friendly busy message", async () => {
  const provider = createOpenAiLlmProvider({
    apiKey: "sk-test",
    fetchImpl: async () =>
      jsonResponse({ error: { message: "Rate limit exceeded", type: "rate_limit_error" } }, 429),
  });

  const result = await provider.complete(sampleRequest);
  assert.equal(result.status, "error");
  assert.ok(result.message?.toLowerCase().includes("busy"));
});

test("timeout handling returns friendly timeout message", async () => {
  const provider = createOpenAiLlmProvider({
    apiKey: "sk-test",
    timeoutMs: 25,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      }),
  });

  const result = await provider.complete(sampleRequest);
  assert.equal(result.status, "error");
  assert.ok(result.message?.toLowerCase().includes("timed out"));
});

test("gpt-5 models use max_completion_tokens when capped", async () => {
  const provider = createOpenAiLlmProvider({
    apiKey: "sk-valid",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_completion_tokens, 500);
      assert.equal("max_tokens" in body, false);
      return jsonResponse({
        choices: [{ message: { content: "Short answer." }, finish_reason: "stop" }],
      });
    },
  });

  const result = await provider.complete({ ...sampleRequest, model: "gpt-5.4", maxTokens: 500 });
  assert.equal(result.status, "success");
});

test("legacy models use max_tokens when capped", async () => {
  const provider = createOpenAiLlmProvider({
    apiKey: "sk-valid",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 500);
      assert.equal("max_completion_tokens" in body, false);
      return jsonResponse({
        choices: [{ message: { content: "Short answer." }, finish_reason: "stop" }],
      });
    },
  });

  const result = await provider.complete({ ...sampleRequest, model: "gpt-4.1-mini", maxTokens: 500 });
  assert.equal(result.status, "success");
});

test("optional max_tokens is sent only when configured", async () => {
  const provider = createOpenAiLlmProvider({
    apiKey: "sk-valid",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 500);
      return jsonResponse({
        choices: [{ message: { content: "Short answer." }, finish_reason: "stop" }],
      });
    },
  });

  const result = await provider.complete({ ...sampleRequest, maxTokens: 500 });
  assert.equal(result.status, "success");
});

test("valid API key returns explanation with usage metadata", async () => {
  const provider = createOpenAiLlmProvider({
    apiKey: "sk-valid",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "gpt-4.1-mini");
      assert.equal(body.temperature, 0.2);
      assert.equal("max_tokens" in body, false);
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.messages[1].role, "user");
      return jsonResponse({
        choices: [{ message: { content: "This deliverable is above the historical average." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      });
    },
  });

  const result = await provider.complete(sampleRequest);
  assert.equal(result.status, "success");
  assert.equal(result.text, "This deliverable is above the historical average.");
  assert.equal(result.usage?.totalTokens, 140);
  assert.ok((result.latencyMs ?? 0) >= 0);
});

test("empty response content is rejected", async () => {
  const provider = createOpenAiLlmProvider({
    apiKey: "sk-valid",
    fetchImpl: async () =>
      jsonResponse({
        choices: [{ message: { content: "   " }, finish_reason: "stop" }],
      }),
  });

  const result = await provider.complete(sampleRequest);
  assert.equal(result.status, "error");
  assert.ok(result.message?.toLowerCase().includes("empty"));
});

test("validateOpenAiResponseContent rejects malformed payloads", () => {
  assert.equal(validateOpenAiResponseContent({}).ok, false);
  assert.equal(validateOpenAiResponseContent({ choices: [{ message: { content: "ok" } }] }).ok, true);
});

test("mapOpenAiErrorToUserMessage never echoes provider error strings", () => {
  const message = mapOpenAiErrorToUserMessage({ status: 500 });
  assert.equal(message.includes("internal"), false);
  assert.ok(message.length > 10);
});

test("NOT_READY validation bypasses provider before OpenAI would be called", () => {
  const pkg = {
    deliverable: { id: "d1", name: "X", classification: null },
    currentDurationDays: null,
    benchmark: null,
    outlier: null,
    evidence: { sampleSize: 0, matchedDeliverables: [], matchedProjects: [] },
    observations: [],
    keyFactors: [],
    forecastReliability: null,
    outcomePrediction: null,
    recommendations: [],
    trust: null,
    evidenceSummary: { sampleSize: 0, matchedDeliverableCount: 0, matchedProjectCount: 0, classificationMatchRate: null },
    citationChain: [],
  };
  const report = validateExplanationContext(pkg, "BENCHMARK");
  assert.equal(report.readiness, "NOT_READY");
  assert.equal(shouldInvokeExplanationProvider(report.readiness), false);
});

test("LIMITED validation would still allow provider invocation", () => {
  const pkg = {
    deliverable: { id: "d1", name: "Design Review", classification: "DESIGN" },
    currentDurationDays: 40,
    benchmark: {
      averageDuration: 35,
      medianDuration: 34,
      minimumDuration: 20,
      maximumDuration: 50,
      sampleSize: 2,
      confidenceLevel: "MEDIUM",
      confidenceScore: 0.5,
      notes: [],
      expectedDuration: null,
      forecastReliability: null,
      predictedOutcome: null,
    },
    outlier: null,
    evidence: { sampleSize: 2, matchedDeliverables: [], matchedProjects: [] },
    observations: [{ findingType: "X", severity: "LOW", confidence: "LOW", title: "t", summary: "s", reasoning: [], evidence: [] }],
    keyFactors: [],
    forecastReliability: null,
    outcomePrediction: null,
    recommendations: [],
    trust: null,
    evidenceSummary: { sampleSize: 2, matchedDeliverableCount: 2, matchedProjectCount: 1, classificationMatchRate: 0.5 },
    citationChain: [],
  };
  const report = validateExplanationContext(pkg, "BENCHMARK");
  assert.equal(report.readiness, "LIMITED");
  assert.equal(shouldInvokeExplanationProvider(report.readiness), true);
});

test("READY validation allows provider invocation", () => {
  const pkg = {
    deliverable: { id: "d1", name: "Design Review", classification: "DESIGN" },
    currentDurationDays: 40,
    benchmark: {
      averageDuration: 35,
      medianDuration: 34,
      minimumDuration: 20,
      maximumDuration: 50,
      sampleSize: 12,
      confidenceLevel: "HIGH",
      confidenceScore: 0.9,
      notes: [],
      expectedDuration: null,
      forecastReliability: null,
      predictedOutcome: null,
    },
    outlier: null,
    evidence: { sampleSize: 12, matchedDeliverables: [], matchedProjects: [] },
    observations: [{ findingType: "X", severity: "LOW", confidence: "HIGH", title: "t", summary: "s", reasoning: [], evidence: [] }],
    keyFactors: [{ factor: "c", impact: "HIGH", summary: "s" }],
    forecastReliability: {
      reliabilityLabel: "High",
      reliabilityBand: "HIGH",
      overrunFrequency: 10,
      sampleSize: 10,
      confidenceLevel: "HIGH",
      confidenceScore: 0.8,
    },
    outcomePrediction: {
      rangeLabel: "30-50",
      predictedMinimumDuration: 30,
      predictedMostLikelyDuration: 40,
      predictedMaximumDuration: 50,
      predictionConfidenceLevel: "HIGH",
      predictionConfidenceScore: 0.85,
      evidenceCount: 12,
      reasoning: [],
    },
    recommendations: [{ id: "r1", type: "D", priority: "M", title: "t", summary: "s", reasoning: [], evidence: [] }],
    trust: { trustScore: 0.9, trustBand: "HIGH", trustLabel: "High", evidenceStrength: {}, knowledgeCoverage: {}, recommendationTraceability: {}, whySeeingThis: [], supportingEvidence: [] },
    evidenceSummary: { sampleSize: 12, matchedDeliverableCount: 8, matchedProjectCount: 4, classificationMatchRate: 0.9 },
    citationChain: [],
  };
  const report = validateExplanationContext(pkg, "BENCHMARK");
  assert.equal(report.readiness, "READY");
  assert.equal(shouldInvokeExplanationProvider(report.readiness), true);
});
