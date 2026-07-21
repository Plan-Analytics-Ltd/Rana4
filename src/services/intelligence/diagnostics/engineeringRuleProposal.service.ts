/**
 * Engineering Brain — rule proposal generation. DEVELOPER ONLY.
 *
 * Phase 2 of docs/engineering-brain-self-learning-spec.md, section 5.
 *
 * Turns accumulated, cross-project evidence about unresolved
 * `ENGINEERING_OBJECT` gaps (the `candidateLearning` observation list already
 * computed by `engineeringBrainDiagnostics.service.ts`) into draft taxonomy
 * rules a developer can approve or reject. Nothing here is auto-promoted:
 * every candidate that clears the threshold is written to
 * `EngineeringRuleProposal` with `status = "PENDING"` and sits in a review
 * queue (Phase 3 UI, not built yet).
 *
 * Explicit scope limit (confirmed against the current implementation of
 * `candidateLearning`, 2026-07-20): `candidateLearning` only ever contains
 * `ENGINEERING_OBJECT` kind entries — `unknownWork` concepts are never fed
 * into it. This module therefore only ever proposes `kind: "OBJECT"` rules.
 * Extending candidate learning to cover WORK is a separate, later task.
 *
 * Design note on linking a candidate back to specific fingerprints (this is
 * the part the spec doesn't spell out): the public `CandidateLearning` /
 * `UnknownConcept` types returned in the diagnostics report are deliberately
 * lossy aggregates (occurrences/projects/consistency numbers only) — they are
 * consumed by the frontend dashboard and are not meant to carry raw evidence.
 * The *records* that back a candidate (each with its own
 * `engineeringIdentityFingerprint(subjectKey, identity)`, exactly as computed
 * for the Brain Inbox / trust groups in step 7b of
 * `computeEngineeringBrainDiagnostics`) are available further upstream, before
 * they get collapsed into `UnknownConcept[]`. `engineeringBrainDiagnostics.
 * service.ts` passes that per-record membership into this module explicitly
 * (see `ObjectGapClusterInput.members`) rather than us trying to reverse a
 * candidate's label back into a subject key.
 */
import { prisma } from "../../../utils/prisma.js";
import {
  ENGINEERING_OBJECT_RULES,
  DISCIPLINE_OBJECT_FALLBACKS,
} from "../taxonomy/engineeringVocabulary.data.js";
import type { StoredEngineeringKnowledge } from "./engineeringKnowledgeStore.service.js";

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

/** One member deliverable contributing to an unresolved-object cluster. */
export type ObjectGapClusterMember = {
  fingerprint: string;
  deliverableName: string;
  projectId: string;
};

/** An unresolved `ENGINEERING_OBJECT` cluster, grouped by `conceptSubject().key`
 * (the same exact-match string clustering `candidateLearning` already uses —
 * per the spec's rollout plan, LLM fuzzy clustering is a later phase). */
export type ObjectGapClusterInput = {
  subjectKey: string;
  conceptLabel: string;
  occurrences: number;
  projectCount: number;
  members: ObjectGapClusterMember[];
};

/* -------------------------------------------------------------------------- */
/* Output                                                                     */
/* -------------------------------------------------------------------------- */

export type EngineeringRuleProposalCandidate = {
  kind: "OBJECT";
  targetId: string;
  targetLabel: string;
  proposedPattern: string;
  rationale: string;
  supportingFingerprints: string[];
  occurrences: number;
  projectCount: number;
  confirmedDecisionCount: number;
  /** 0..1, share of *confirmed* members agreeing on the same resolution. */
  consistency: number;
  /** 0..1, gated to 0 unless confirmedDecisionCount >= 1. */
  confidenceScore: number;
};

/* -------------------------------------------------------------------------- */
/* Scoring thresholds (spec section 5.5)                                     */
/* -------------------------------------------------------------------------- */

const MIN_CONFIDENCE_SCORE = 0.5;
const MIN_CONFIRMED_DECISIONS = 1;
const MIN_PROJECT_COUNT = 2;

/* -------------------------------------------------------------------------- */
/* Pattern mining (spec section 5.4) — same shape as engineeringVocabulary.data.ts */
/* -------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "of",
  "to",
  "in",
  "on",
  "at",
  "new",
  "works",
  "work",
  "package",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenise(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

/**
 * Derive a regex pattern from vocabulary shared across a cluster's raw
 * deliverable names, in the same `\bword\s+word(s)?\b` style already used by
 * hand-written `ENGINEERING_OBJECT_RULES` entries. Falls back to the shared
 * subject label itself when the raw names don't all agree on a token (e.g. a
 * single-member cluster, or wildly differing wording).
 */
export function mineObjectPattern(conceptLabel: string, deliverableNames: string[]): string {
  const labelTokens = tokenise(conceptLabel);
  let shared = new Set(labelTokens);
  for (const name of deliverableNames) {
    const nameTokens = new Set(tokenise(name));
    shared = new Set([...shared].filter((token) => nameTokens.has(token)));
    if (shared.size === 0) break;
  }
  const ordered = labelTokens.filter((token) => shared.has(token));
  const words = ordered.length > 0 ? ordered : labelTokens;

  if (words.length === 0) {
    const fallback = escapeRegExp(conceptLabel.toLowerCase().trim());
    return fallback ? `\\b${fallback}\\b` : "";
  }

  const escaped = words.map((word, index) => {
    const isLast = index === words.length - 1;
    const base = escapeRegExp(word);
    return isLast && !base.endsWith("s") ? `${base}s?` : base;
  });
  return `\\b${escaped.join("\\s+")}\\b`;
}

/* -------------------------------------------------------------------------- */
/* Target id/label resolution                                                */
/* -------------------------------------------------------------------------- */

function knownObjectLabel(objectId: string): string | null {
  const rule = ENGINEERING_OBJECT_RULES.find((r) => r.id === objectId);
  if (rule) return rule.label;
  const fallback = Object.values(DISCIPLINE_OBJECT_FALLBACKS).find((f) => f.id === objectId);
  return fallback ? fallback.label : null;
}

function titleCaseId(id: string): string {
  return id
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function decisionSignature(identity: StoredEngineeringKnowledge["identity"]): string {
  return [identity.discipline ?? "?", identity.engineeringObject ?? "?", identity.engineeringWork ?? "?"].join(
    "|"
  );
}

/* -------------------------------------------------------------------------- */
/* Candidate scoring (spec section 5.2-5.5) — pure, no DB access             */
/* -------------------------------------------------------------------------- */

export function computeEngineeringRuleProposalCandidates(args: {
  clusters: ObjectGapClusterInput[];
  decisions: Map<string, StoredEngineeringKnowledge>;
}): EngineeringRuleProposalCandidate[] {
  const { clusters, decisions } = args;
  const results: EngineeringRuleProposalCandidate[] = [];

  for (const cluster of clusters) {
    // Cross-reference confirmed ground truth. A decision only counts as
    // ground truth for an OBJECT proposal if a human actually confirmed a
    // resolved engineering object for it — a developer confirming "yes, this
    // genuinely has no engineering object" gives us nothing to propose.
    const confirmedByFingerprint = new Map<string, StoredEngineeringKnowledge>();
    for (const member of cluster.members) {
      const decision = decisions.get(member.fingerprint);
      if (!decision) continue;
      if (decision.status !== "DEVELOPER_APPROVED" && decision.status !== "DEVELOPER_MODIFIED") continue;
      if (!decision.identity.engineeringObject) continue;
      confirmedByFingerprint.set(member.fingerprint, decision);
    }

    const confirmedDecisionCount = confirmedByFingerprint.size;
    // Safeguard (spec 5.2): zero confirmed decisions never generates a
    // proposal — no proposal is drafted purely from the engine's own
    // unconfirmed uncertainty.
    if (confirmedDecisionCount < MIN_CONFIRMED_DECISIONS) continue;

    // Consistency: share of confirmed members agreeing on the same
    // (discipline|object|work) resolution.
    const bySignature = new Map<string, { count: number; decision: StoredEngineeringKnowledge; fingerprints: string[] }>();
    for (const [fingerprint, decision] of confirmedByFingerprint) {
      const sig = decisionSignature(decision.identity);
      const entry = bySignature.get(sig);
      if (entry) {
        entry.count += 1;
        entry.fingerprints.push(fingerprint);
      } else {
        bySignature.set(sig, { count: 1, decision, fingerprints: [fingerprint] });
      }
    }
    let majority: { count: number; decision: StoredEngineeringKnowledge; fingerprints: string[] } | null = null;
    for (const entry of bySignature.values()) {
      if (!majority || entry.count > majority.count) majority = entry;
    }
    if (!majority) continue; // unreachable (confirmedDecisionCount >= 1 guarantees an entry)

    const consistency = majority.count / confirmedDecisionCount;

    const occurrences = cluster.occurrences;
    const projectCount = cluster.projectCount;
    const confidenceScore =
      confirmedDecisionCount >= MIN_CONFIRMED_DECISIONS
        ? Math.min(1, occurrences / 20) * 0.3 + Math.min(1, projectCount / 3) * 0.3 + consistency * 0.4
        : 0;

    // Threshold (spec 5.5).
    if (
      confidenceScore < MIN_CONFIDENCE_SCORE ||
      confirmedDecisionCount < MIN_CONFIRMED_DECISIONS ||
      projectCount < MIN_PROJECT_COUNT
    ) {
      continue;
    }

    const targetId = majority.decision.identity.engineeringObject as string;
    const targetLabel = knownObjectLabel(targetId) ?? titleCaseId(targetId) ?? cluster.conceptLabel;

    const proposedPattern = mineObjectPattern(
      cluster.conceptLabel,
      cluster.members.map((m) => m.deliverableName)
    );
    if (!proposedPattern) continue;

    const rationale =
      `Seen ${occurrences} time(s) across ${projectCount} project(s) resolving to an unknown engineering object ` +
      `for "${cluster.conceptLabel}". ${confirmedDecisionCount} developer decision(s) already confirm this resolves ` +
      `to "${targetLabel}"` +
      (consistency < 1
        ? ` (${Math.round(consistency * 100)}% of confirmed decisions agree; the rest disagree).`
        : " (unanimous).");

    results.push({
      kind: "OBJECT",
      targetId,
      targetLabel,
      proposedPattern,
      rationale,
      supportingFingerprints: majority.fingerprints,
      occurrences,
      projectCount,
      confirmedDecisionCount,
      consistency,
      confidenceScore,
    });
  }

  return results;
}

/* -------------------------------------------------------------------------- */
/* Persistence — graceful degradation, same pattern as                       */
/* engineeringKnowledgeStore.service.ts.                                     */
/* -------------------------------------------------------------------------- */

type ProposalDelegate = {
  findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
};

function proposalDelegate(): ProposalDelegate | null {
  const delegate = (prisma as unknown as Record<string, unknown>)["engineeringRuleProposal"];
  if (delegate && typeof (delegate as ProposalDelegate).findFirst === "function") {
    return delegate as ProposalDelegate;
  }
  return null;
}

export function isEngineeringRuleProposalStoreAvailable(): boolean {
  return proposalDelegate() != null;
}

export type PersistEngineeringRuleProposalsResult = {
  created: number;
  updated: number;
  skippedRejected: number;
};

/**
 * Upsert scored candidates into `EngineeringRuleProposal`, keyed by the
 * table's `@@unique([companyId, kind, targetId, proposedPattern])`.
 *
 * Per spec section 6: if a REJECTED proposal already exists for the exact
 * same (kind, targetId, proposedPattern), it is never resurfaced — the
 * evidence numbers are not refreshed and the row is left untouched.
 *
 * Never throws: if the table/delegate isn't available yet (migration not
 * deployed), this is a no-op, matching the rest of the Engineering Brain's
 * degrade-gracefully pattern.
 */
export async function persistEngineeringRuleProposals(args: {
  companyId: string;
  candidates: EngineeringRuleProposalCandidate[];
}): Promise<PersistEngineeringRuleProposalsResult> {
  const delegate = proposalDelegate();
  const result: PersistEngineeringRuleProposalsResult = { created: 0, updated: 0, skippedRejected: 0 };
  if (!delegate) return result;

  for (const candidate of args.candidates) {
    try {
      const existing = await delegate.findFirst({
        where: {
          companyId: args.companyId,
          kind: candidate.kind,
          targetId: candidate.targetId,
          proposedPattern: candidate.proposedPattern,
        },
      });

      if (existing && String(existing.status) === "REJECTED") {
        result.skippedRejected += 1;
        continue;
      }

      if (existing) {
        await delegate.update({
          where: { id: String(existing.id) },
          data: {
            targetLabel: candidate.targetLabel,
            rationale: candidate.rationale,
            supportingFingerprints: candidate.supportingFingerprints,
            occurrences: candidate.occurrences,
            projectCount: candidate.projectCount,
            confirmedDecisionCount: candidate.confirmedDecisionCount,
            consistency: candidate.consistency,
            confidenceScore: candidate.confidenceScore,
          },
        });
        result.updated += 1;
      } else {
        await delegate.create({
          data: {
            companyId: args.companyId,
            kind: candidate.kind,
            targetId: candidate.targetId,
            targetLabel: candidate.targetLabel,
            proposedPattern: candidate.proposedPattern,
            rationale: candidate.rationale,
            supportingFingerprints: candidate.supportingFingerprints,
            occurrences: candidate.occurrences,
            projectCount: candidate.projectCount,
            confirmedDecisionCount: candidate.confirmedDecisionCount,
            consistency: candidate.consistency,
            confidenceScore: candidate.confidenceScore,
          },
        });
        result.created += 1;
      }
    } catch {
      // Graceful degradation — a persistence failure for one candidate must
      // never break the diagnostics report.
    }
  }

  return result;
}
