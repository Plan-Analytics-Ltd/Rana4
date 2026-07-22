/**
 * Persistence + resolution-time loading for `EngineeringLearnedRule` — the
 * DB-backed overlay of rules a developer approved from a rule proposal.
 * Phase 3 of docs/engineering-brain-self-learning-spec.md, sections 4.2 & 7.
 *
 * Same graceful-degradation pattern as engineeringKnowledgeStore.service.ts:
 * if the generated client or the table aren't present yet, every operation
 * degrades gracefully (empty reads, no-op writes) so the Engineering Brain
 * keeps working exactly as before — it simply won't have any learned rules
 * to merge in until the migration is deployed.
 *
 * Kept as its own table (rather than just flipping a proposal's status) so
 * resolution-time loading is a trivial `where: { active: true }` query, and
 * disabling a learned rule later doesn't lose the original proposal's audit
 * trail (spec section 4.2).
 */
import { prisma } from "../../../utils/prisma.js";
import type { EngineeringObjectRule } from "../taxonomy/engineeringVocabulary.data.js";

export type StoredEngineeringLearnedRule = {
  id: string;
  companyId: string;
  kind: string;
  targetId: string;
  targetLabel: string;
  pattern: string;
  sourceProposalId: string;
  active: boolean;
  createdAt: string;
};

type LearnedRuleDelegate = {
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
};

function learnedRuleDelegate(): LearnedRuleDelegate | null {
  const delegate = (prisma as unknown as Record<string, unknown>)["engineeringLearnedRule"];
  if (delegate && typeof (delegate as LearnedRuleDelegate).findMany === "function") {
    return delegate as LearnedRuleDelegate;
  }
  return null;
}

export function isEngineeringLearnedRuleStoreAvailable(): boolean {
  return learnedRuleDelegate() != null;
}

function toStored(row: Record<string, unknown>): StoredEngineeringLearnedRule {
  return {
    id: String(row.id ?? ""),
    companyId: String(row.companyId ?? ""),
    kind: String(row.kind ?? ""),
    targetId: String(row.targetId ?? ""),
    targetLabel: String(row.targetLabel ?? ""),
    pattern: String(row.pattern ?? ""),
    sourceProposalId: String(row.sourceProposalId ?? ""),
    active: Boolean(row.active ?? true),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? new Date().toISOString()),
  };
}

/**
 * Load every active, company-scoped OBJECT-kind learned rule and shape it as
 * an `EngineeringObjectRule` ready to merge into `listEngineeringObjectCandidates`.
 * Only OBJECT is wired at resolution time today — the only kind the proposal
 * engine currently generates (see engineeringRuleProposal.service.ts). Never
 * throws: returns [] on any failure or if the store isn't available yet.
 */
export async function loadActiveLearnedObjectRules(companyId: string): Promise<EngineeringObjectRule[]> {
  const delegate = learnedRuleDelegate();
  if (!delegate) return [];
  try {
    const rows = await delegate.findMany({ where: { companyId, kind: "OBJECT", active: true } });
    return rows.map((row) => {
      const stored = toStored(row);
      const rule: EngineeringObjectRule = {
        id: stored.targetId,
        label: stored.targetLabel,
        patterns: [stored.pattern],
        origin: "LEARNED_RULE",
      };
      return rule;
    });
  } catch {
    return [];
  }
}

/**
 * Create the EngineeringLearnedRule row for an approved proposal. Called by
 * engineeringRuleProposal.service.ts's approveRuleProposal — kept in this
 * module since it owns the EngineeringLearnedRule delegate. Never throws:
 * returns null on any failure or if the store isn't available.
 */
export async function createLearnedRule(args: {
  companyId: string;
  kind: string;
  targetId: string;
  targetLabel: string;
  pattern: string;
  sourceProposalId: string;
}): Promise<StoredEngineeringLearnedRule | null> {
  const delegate = learnedRuleDelegate();
  if (!delegate) return null;
  try {
    const row = await delegate.create({
      data: {
        companyId: args.companyId,
        kind: args.kind,
        targetId: args.targetId,
        targetLabel: args.targetLabel,
        pattern: args.pattern,
        sourceProposalId: args.sourceProposalId,
        active: true,
      },
    });
    return toStored(row);
  } catch {
    return null;
  }
}

/**
 * Instantly revert a bad promotion (spec section 3: "a one-row delete to
 * instantly revert a bad promotion" — implemented as a soft deactivate so the
 * audit trail/row survives). Never throws.
 */
export async function deactivateLearnedRule(args: { companyId: string; id: string }): Promise<boolean> {
  const delegate = learnedRuleDelegate();
  if (!delegate) return false;
  try {
    // updateMany (not update-by-id) so the companyId filter is enforced by
    // the query itself, not just by the caller remembering to check it —
    // same tenant-isolation posture as the rest of the Engineering Brain.
    const result = await delegate.updateMany({
      where: { id: args.id, companyId: args.companyId },
      data: { active: false },
    });
    return result.count > 0;
  } catch {
    return false;
  }
}
