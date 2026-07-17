/**
 * Import reviewed Engineering Brain decisions from brain-review-decisions.json
 * into the knowledge store via POST /dev/engineering-brain/review.
 *
 * Usage (server must be running: npm run dev):
 *
 *   # Option A — bearer token from browser dev session or Postman
 *   DEV_AUTH_TOKEN=eyJ... npx tsx scripts/importBrainReviewDecisions.ts
 *
 *   # Option B — dev-panel login (email must pass requireDevEmail)
 *   DEV_EMAIL=aelsaman@plananalytics.co.uk DEV_PASSWORD=... npx tsx scripts/importBrainReviewDecisions.ts
 *
 *   # Optional overrides
 *   API_URL=http://localhost:3001 npx tsx scripts/importBrainReviewDecisions.ts [path/to/decisions.json]
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

type ReviewAction = "approve" | "modify" | "reject";

type DecisionFileEntry = {
  fingerprint: string;
  deliverableName: string;
  decision: {
    action: "APPROVE" | "MODIFY" | "REJECT";
    fields: {
      discipline: string | null;
      engineeringObject: string | null;
      engineeringWork: string | null;
      deliverableType: string | null;
      lifecycle: string | null;
      aliases: string[];
    };
  };
  rationale?: string;
};

type DecisionFile = {
  decisions: DecisionFileEntry[];
};

type ReviewRequestBody = {
  fingerprint: string;
  action: ReviewAction;
  concept: string;
  identity: {
    discipline: string | null;
    engineeringObject: string | null;
    engineeringWork: string | null;
    deliverableType: string | null;
    lifecycleStage: string | null;
  };
  aliases: string[];
  notes: string | null;
};

function apiBaseUrl(): string {
  if (process.env.API_URL?.trim()) return process.env.API_URL.replace(/\/$/, "");
  const port = process.env.PORT?.trim() || "3001";
  return `http://localhost:${port}`;
}

function mapAction(action: DecisionFileEntry["decision"]["action"]): ReviewAction {
  return action.toLowerCase() as ReviewAction;
}

function mapEntry(entry: DecisionFileEntry): ReviewRequestBody {
  const { fields } = entry.decision;
  return {
    fingerprint: entry.fingerprint,
    action: mapAction(entry.decision.action),
    concept: entry.deliverableName,
    identity: {
      discipline: fields.discipline,
      engineeringObject: fields.engineeringObject,
      engineeringWork: fields.engineeringWork,
      deliverableType: fields.deliverableType,
      lifecycleStage: fields.lifecycle,
    },
    aliases: Array.isArray(fields.aliases) ? fields.aliases : [],
    notes: entry.rationale?.trim() ? entry.rationale.trim() : null,
  };
}

async function resolveAuthToken(baseUrl: string): Promise<string> {
  const fromEnv = process.env.DEV_AUTH_TOKEN?.trim() || process.env.AUTH_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const email = process.env.DEV_EMAIL?.trim();
  const password = process.env.DEV_PASSWORD;
  if (email && password) {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const text = await res.text();
    let data: { token?: string; error?: string } | null = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok || !data?.token) {
      throw new Error(
        `Login failed (${res.status}): ${data?.error ?? text ?? "no token returned"}`
      );
    }
    return data.token;
  }

  throw new Error(
    "Authentication required. Set DEV_AUTH_TOKEN (or AUTH_TOKEN), or DEV_EMAIL + DEV_PASSWORD for a dev-panel account."
  );
}

async function postReview(
  baseUrl: string,
  token: string,
  body: ReviewRequestBody
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${baseUrl}/dev/engineering-brain/review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function main(): Promise<void> {
  const baseUrl = apiBaseUrl();
  const fileArg = process.argv[2];
  const filePath = path.resolve(fileArg ?? path.join(process.cwd(), "brain-review-decisions.json"));

  if (!fs.existsSync(filePath)) {
    console.error(`Decisions file not found: ${filePath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as DecisionFile;
  if (!Array.isArray(raw.decisions) || raw.decisions.length === 0) {
    console.error("No decisions[] entries found in file.");
    process.exit(1);
  }

  const total = raw.decisions.length;
  console.log(`Importing ${total} decisions from ${filePath}`);
  console.log(`API: ${baseUrl}/dev/engineering-brain/review`);

  const token = await resolveAuthToken(baseUrl);
  console.log("Authenticated.\n");

  let succeeded = 0;

  for (let i = 0; i < raw.decisions.length; i += 1) {
    const entry = raw.decisions[i];
    const body = mapEntry(entry);
    const label = `[${i + 1}/${total}] ${entry.fingerprint} — ${entry.deliverableName}`;

    const result = await postReview(baseUrl, token, body);
    if (!result.ok) {
      console.error(`FAIL ${label}`);
      console.error(`  HTTP ${result.status}`);
      console.error(`  Response: ${JSON.stringify(result.data)}`);
      console.error(`\nStopped on first failure.`);
      console.error(`Summary: ${succeeded} succeeded / ${total - succeeded} failed out of ${total}.`);
      process.exit(1);
    }

    succeeded += 1;
    console.log(`OK   ${label} → ${body.action} (${result.status})`);
  }

  console.log(`\nDone. ${succeeded} succeeded / 0 failed out of ${total}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
