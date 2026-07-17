/**
 * Apply Batch 2 human-reviewed Engineering Brain corrections.
 *
 * Reads docs/brain-review-decisions-batch2.json, diffs against existing
 * EngineeringKnowledgeEntry rows, and (only with --confirm) POSTs modify
 * decisions to /dev/engineering-brain/review — preserving aliases and
 * appending evidence/notes.
 *
 *   npx tsx scripts/apply-brain-review-batch2.ts
 *   npx tsx scripts/apply-brain-review-batch2.ts --confirm
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  loadEngineeringKnowledge,
  recordEngineeringReviewDecision,
  isEngineeringKnowledgeStoreAvailable,
  type StoredEngineeringKnowledge,
} from "../src/services/intelligence/diagnostics/engineeringKnowledgeStore.service.js";
import { resolveDefaultCompanyId } from "../src/services/intelligence/taxonomy/engineeringReasoningBackfill.service.js";

const prisma = new PrismaClient();

type BatchIdentity = {
  discipline: string | null;
  engineeringObject: string | null;
  engineeringWork: string | null;
  deliverableType: string | null;
  lifecycleStage: string | null;
};

type BatchDecision = {
  concept: string;
  fingerprint: string;
  action: "modify" | "approve" | "reject";
  identity: BatchIdentity;
  evidence?: string;
  notes?: string;
};

type BatchFile = {
  decisions: BatchDecision[];
  explicitlyExcluded?: { fingerprints: string[]; reason?: string };
  holdForHumanReview?: { fingerprints: string[]; reason?: string };
};

const FIELDS = [
  "discipline",
  "engineeringObject",
  "engineeringWork",
  "deliverableType",
  "lifecycleStage",
] as const;

function identityLabel(id: BatchIdentity): string {
  return `${id.discipline ?? "?"}/${id.engineeringObject ?? "?"}/${id.engineeringWork ?? "?"} (type=${id.deliverableType ?? "?"}, stage=${id.lifecycleStage ?? "?"})`;
}

function fieldDiffs(before: BatchIdentity, after: BatchIdentity): string[] {
  const diffs: string[] = [];
  for (const field of FIELDS) {
    const a = before[field] ?? null;
    const b = after[field] ?? null;
    if (a !== b) diffs.push(`${field}: ${a ?? "null"} -> ${b ?? "null"}`);
  }
  return diffs;
}

function apiBaseUrl(): string {
  if (process.env.API_URL?.trim()) return process.env.API_URL.replace(/\/$/, "");
  // Backend `npm run dev` listens on PORT (default 3000 in this repo).
  const port = process.env.PORT?.trim() || "3000";
  return `http://localhost:${port}`;
}

async function resolveAuthToken(baseUrl: string): Promise<string> {
  const fromEnv = process.env.DEV_AUTH_TOKEN?.trim() || process.env.AUTH_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const email = process.env.DEV_EMAIL?.trim() || process.env.DEV_PANEL_EMAIL?.trim();
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
      throw new Error(`Login failed (${res.status}): ${data?.error ?? text ?? "no token"}`);
    }
    return data.token;
  }

  throw new Error(
    "Authentication required. Set DEV_AUTH_TOKEN (or AUTH_TOKEN), or DEV_EMAIL + DEV_PASSWORD."
  );
}

function mergeEvidence(existing: string[], incoming: string | undefined): string[] {
  if (!incoming?.trim()) return existing;
  const next = incoming.trim();
  if (existing.includes(next)) return existing;
  return [...existing, next];
}

function mergeNotes(existing: string | null, incoming: string | undefined): string | null {
  const add = incoming?.trim() || null;
  if (!add) return existing;
  if (!existing?.trim()) return add;
  if (existing.includes(add)) return existing;
  return `${existing.trim()}\n\n[Batch 2] ${add}`;
}

async function postReview(
  baseUrl: string,
  token: string,
  body: Record<string, unknown>
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
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { ok: res.ok, status: res.status, data };
}

function existingIdentity(entry: StoredEngineeringKnowledge): BatchIdentity {
  return {
    discipline: entry.identity.discipline,
    engineeringObject: entry.identity.engineeringObject,
    engineeringWork: entry.identity.engineeringWork,
    deliverableType: entry.identity.deliverableType,
    lifecycleStage: entry.identity.lifecycleStage,
  };
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm") || process.argv.includes("--execute");
  const filePath = path.resolve(process.cwd(), "docs/brain-review-decisions-batch2.json");
  if (!fs.existsSync(filePath)) {
    throw new Error(`Batch file not found: ${filePath}`);
  }

  const batch = JSON.parse(fs.readFileSync(filePath, "utf8")) as BatchFile;
  const excluded = new Set([
    ...(batch.explicitlyExcluded?.fingerprints ?? []),
    ...(batch.holdForHumanReview?.fingerprints ?? []),
  ]);

  const { companyId, companyName, email } = await resolveDefaultCompanyId(prisma);
  const knowledge = await loadEngineeringKnowledge(companyId);

  console.log(`Company: ${companyName ?? "?"} (${companyId}) via ${email}`);
  console.log(`Mode: ${confirm ? "EXECUTE (--confirm)" : "DRY-RUN (diff only — no writes)"}`);
  console.log(`Batch decisions: ${batch.decisions.length}`);
  console.log(`Excluded fingerprints (skip): ${[...excluded].join(", ") || "(none)"}`);
  console.log("");

  type Planned = {
    decision: BatchDecision;
    existing: StoredEngineeringKnowledge;
    diffs: string[];
  };
  const planned: Planned[] = [];
  const notFound: BatchDecision[] = [];
  const skippedExcluded: string[] = [];

  for (const decision of batch.decisions) {
    if (excluded.has(decision.fingerprint)) {
      skippedExcluded.push(`${decision.fingerprint} (${decision.concept})`);
      console.log(`SKIP excluded ${decision.fingerprint} — ${decision.concept}`);
      continue;
    }
    const existing = knowledge.get(decision.fingerprint);
    if (!existing) {
      notFound.push(decision);
      console.log(`NOT FOUND ${decision.fingerprint} — ${decision.concept}`);
      continue;
    }
    const before = existingIdentity(existing);
    const diffs = fieldDiffs(before, decision.identity);
    planned.push({ decision, existing, diffs });
    console.log("=".repeat(88));
    console.log(`${decision.concept}`);
    console.log(`  fingerprint: ${decision.fingerprint}`);
    console.log(`  status now:  ${existing.status}`);
    console.log(`  aliases:     ${existing.aliases.length ? existing.aliases.join(", ") : "(none — will preserve)"}`);
    console.log(`  BEFORE: ${identityLabel(before)}`);
    console.log(`  AFTER:  ${identityLabel(decision.identity)}`);
    if (diffs.length === 0) console.log("  diffs: (none — identity already matches)");
    else for (const d of diffs) console.log(`  diff: ${d}`);
    if (decision.evidence) console.log(`  +evidence: ${decision.evidence}`);
    if (decision.notes) console.log(`  +notes: ${decision.notes}`);
  }

  // Confirm excluded fingerprints were not in the decisions list either, and remain untouched.
  for (const fp of excluded) {
    const inBatch = batch.decisions.some((d) => d.fingerprint === fp);
    const entry = knowledge.get(fp);
    console.log("=".repeat(88));
    console.log(
      `EXCLUDED CHECK ${fp}: inBatchDecisions=${inBatch} storeStatus=${entry?.status ?? "MISSING"} concept=${entry?.concept ?? "?"}`
    );
    if (entry) console.log(`  identity left as: ${identityLabel(existingIdentity(entry))}`);
  }

  console.log("\n=== Dry-run summary ===");
  console.log(
    JSON.stringify(
      {
        plannedUpdates: planned.length,
        unchangedIdentity: planned.filter((p) => p.diffs.length === 0).length,
        notFound: notFound.map((d) => ({ fingerprint: d.fingerprint, concept: d.concept })),
        skippedExcluded,
        excludedLeftUntouched: [...excluded],
      },
      null,
      2
    )
  );

  if (!confirm) {
    console.log(
      "\nStopped before any writes.\nRe-run with --confirm to POST modify decisions to /dev/engineering-brain/review."
    );
    process.exit(notFound.length > 0 ? 1 : 0);
  }

  if (planned.length === 0) {
    console.log("\nNothing to apply.");
    process.exit(notFound.length > 0 ? 1 : 0);
  }

  const baseUrl = apiBaseUrl();
  let useDirect = process.argv.includes("--direct");
  let token: string | null = null;
  if (!useDirect) {
    try {
      token = await resolveAuthToken(baseUrl);
      console.log(`\n=== Applying ${planned.length} modifications via ${baseUrl}/dev/engineering-brain/review ===`);
    } catch {
      useDirect = true;
      console.log(
        "\nNo API auth token available — applying directly via recordEngineeringReviewDecision (same persistence path as the review endpoint)."
      );
    }
  } else {
    console.log(`\n=== Applying ${planned.length} modifications directly (recordEngineeringReviewDecision) ===`);
  }

  if (useDirect && !isEngineeringKnowledgeStoreAvailable()) {
    throw new Error("Engineering knowledge store unavailable (migration not applied?)");
  }

  let updated = 0;
  const failures: Array<{ fingerprint: string; concept: string; detail: string }> = [];

  for (const item of planned) {
    const { decision, existing } = item;
    const payload = {
      fingerprint: decision.fingerprint,
      action: "MODIFY" as const,
      concept: decision.concept || existing.concept,
      identity: decision.identity,
      aliases: existing.aliases,
      evidence: mergeEvidence(existing.evidence, decision.evidence),
      notes: mergeNotes(existing.reviewNotes, decision.notes),
      reviewedBy: "batch2-apply-script",
    };

    if (useDirect) {
      const entry = await recordEngineeringReviewDecision({
        companyId,
        ...payload,
        observed: {
          projectCount: existing.projectCount,
          successfulComparisons: existing.successfulComparisons,
          firstObservedAt: existing.firstObservedAt,
          lastObservedAt: existing.lastObservedAt,
        },
      });
      if (!entry) {
        failures.push({
          fingerprint: decision.fingerprint,
          concept: decision.concept,
          detail: "recordEngineeringReviewDecision returned null",
        });
        console.error(`FAIL ${decision.fingerprint} — ${decision.concept}`);
        continue;
      }
      updated += 1;
      console.log(`OK   ${decision.fingerprint} — ${decision.concept} (direct)`);
      continue;
    }

    const result = await postReview(baseUrl, token!, payload);
    if (!result.ok) {
      failures.push({
        fingerprint: decision.fingerprint,
        concept: decision.concept,
        detail: `HTTP ${result.status}: ${JSON.stringify(result.data)}`,
      });
      console.error(`FAIL ${decision.fingerprint} — ${decision.concept}`);
      console.error(`  ${failures[failures.length - 1]!.detail}`);
      continue;
    }
    updated += 1;
    console.log(`OK   ${decision.fingerprint} — ${decision.concept}`);
  }

  // Re-load to confirm excluded untouched.
  const after = await loadEngineeringKnowledge(companyId);
  const excludedChecks: Record<string, { before: string; after: string; status: string }> = {};
  for (const fp of excluded) {
    const b = knowledge.get(fp);
    const a = after.get(fp);
    excludedChecks[fp] = {
      before: b ? identityLabel(existingIdentity(b)) : "(missing)",
      after: a ? identityLabel(existingIdentity(a)) : "(missing)",
      status: a?.status ?? "MISSING",
    };
  }

  console.log("\n=== Apply results ===");
  console.log(
    JSON.stringify(
      {
        updated,
        planned: planned.length,
        failures,
        notFound: notFound.map((d) => ({ fingerprint: d.fingerprint, concept: d.concept })),
        excludedUntouched: excludedChecks,
      },
      null,
      2
    )
  );

  if (failures.length > 0 || notFound.length > 0) process.exit(1);
  console.log(
    `\nDone. ${updated}/${planned.length} updated. Duration-stats should reflect these on next page load (knowledge store is read live).`
  );
  process.exit(0);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
