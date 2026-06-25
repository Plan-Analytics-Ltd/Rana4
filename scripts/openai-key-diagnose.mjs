import "dotenv/config";

const raw = process.env.OPENAI_API_KEY ?? "";
const key = String(raw).trim();
const model = String(process.env.AI_EXPLANATION_MODEL ?? "").trim() || "gpt-5.4";

console.log("Key length:", key.length);
console.log("Starts with sk-:", key.startsWith("sk-"));
console.log("Starts with sk-proj-:", key.startsWith("sk-proj-"));
console.log("Wrapped in quotes:", /^["']/.test(String(raw).trim()));
console.log("Trailing/leading whitespace in raw:", raw !== key);
console.log("Model:", model);

if (!key) {
  console.log("RESULT: no key set");
  process.exit(1);
}

for (const endpoint of ["/v1/models", "/v1/chat/completions"]) {
  const url = `https://api.openai.com${endpoint}`;
  const init =
    endpoint === "/v1/models"
      ? { method: "GET", headers: { Authorization: `Bearer ${key}` } }
      : {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 5,
          }),
        };

  const response = await fetch(url, init);
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  console.log(`\n${endpoint}`);
  console.log("HTTP status:", response.status);
  if (payload.error?.code) console.log("Error code:", payload.error.code);
  if (payload.error?.type) console.log("Error type:", payload.error.type);
}
