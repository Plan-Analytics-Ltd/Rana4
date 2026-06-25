/**
 * Verify OPENAI_API_KEY with a minimal chat completion (live API call).
 * Run: npm run test:openai-key
 */
import "dotenv/config";
import {
  buildOpenAiCompletionBody,
  readOpenAiApiKey,
} from "../../../dist/services/integrations/openai/openaiLlmProvider.js";

const key = readOpenAiApiKey();
if (!key) {
  console.error("FAIL: OPENAI_API_KEY is not set in the environment.");
  process.exitCode = 1;
} else {
  const model = String(process.env.AI_EXPLANATION_MODEL ?? "").trim() || "gpt-4.1-mini";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildOpenAiCompletionBody({
        model,
        temperature: 0,
        maxTokens: 10,
        system: "Reply with exactly: OK",
        user: "Health check",
      })
    ),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error(`FAIL: OpenAI returned a non-JSON response (HTTP ${response.status}).`);
    process.exitCode = 1;
    payload = null;
  }

  if (payload) {
    if (response.ok && payload.choices?.[0]?.message?.content) {
      const text = String(payload.choices[0].message.content).trim();
      console.log("PASS: OpenAI API key is valid and the model responded.");
      console.log(`Model: ${model}`);
      if (payload.usage?.total_tokens != null) {
        console.log(`Tokens used: ${payload.usage.total_tokens}`);
      }
      console.log(`Sample response: ${text.slice(0, 80)}`);
      process.exitCode = 0;
    } else if (payload.error?.code === "insufficient_quota") {
      console.log("PARTIAL: API key is valid (authenticated), but the account has no API quota.");
      console.log("Your key works — OpenAI rejected the request because billing/credits are not available.");
      console.log("Fix: https://platform.openai.com/settings/organization/billing");
      console.log("Also check usage limits: https://platform.openai.com/settings/organization/limits");
      process.exitCode = 2;
    } else {
      console.error("FAIL: OpenAI API key check did not succeed.");
      console.error(`HTTP status: ${response.status}`);
      if (payload.error?.code) console.error(`Error code: ${payload.error.code}`);
      if (payload.error?.type) console.error(`Error type: ${payload.error.type}`);
      if (payload.error?.param) console.error(`Parameter: ${payload.error.param}`);
      if (payload.error?.message) console.error(`Detail: ${payload.error.message}`);

      if (response.status === 401 || payload.error?.code === "invalid_api_key") {
        console.error("The API key appears invalid. Generate a new key at https://platform.openai.com/api-keys");
      } else if (response.status === 404 || payload.error?.code === "model_not_found") {
        console.error(`Model "${model}" was not found. Check AI_EXPLANATION_MODEL in your .env.`);
      } else if (response.status === 429 && payload.error?.code === "rate_limit_exceeded") {
        console.error("Rate limit hit. Wait a moment and try again.");
      } else if (response.status === 429) {
        console.error("Request throttled. Check billing and usage on your OpenAI account.");
      } else if (payload.error?.code === "unsupported_parameter") {
        console.error("The request used an API parameter this model does not support.");
      }

      process.exitCode = 1;
    }
  }
}
