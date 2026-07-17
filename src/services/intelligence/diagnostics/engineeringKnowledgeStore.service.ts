/**
 * Persistence for the rare developer review decisions — DEVELOPER ONLY.
 *
 * Only approve / modify / reject decisions and their version history are stored
 * (auto-trusted identities are recomputed, never persisted). Access to the
 * Prisma model is delegate-optional: if the generated client or the table are
 * not yet present, every operation degrades gracefully (empty reads, no-op
 * writes) so the Engineering Brain keeps working — it simply won't remember
 * corrections until the migration is deployed.
 */
import { prisma } from "../../../utils/prisma.js";
import { getEngineeringBrainVersions } from "../taxonomy/engineeringBrainVersion.js";
import type { TrustedKnowledgeStatus } from "../taxonomy/engineeringTrust.service.js";

export type EngineeringReviewAction = "APPROVE" | "MODIFY" | "REJECT";

export type EngineeringKnowledgeIdentity = {
  discipline: string | null;
  engineeringObject: string | null;
  engineeringWork: string | null;
  deliverableType: string | null;
  lifecycleStage: string | null;
};

export type EngineeringKnowledgeVersionEntry = {
  at: string;
  action: EngineeringReviewAction;
  status: TrustedKnowledgeStatus;
  reviewedBy: string | null;
  identity: EngineeringKnowledgeIdentity;
  notes: string | null;
};

export type StoredEngineeringKnowledge = {
  /** Immutable DB id when available (null if store offline / not persisted). */
  knowledgeEntryId: string | null;
  fingerprint: string;
  status: TrustedKnowledgeStatus;
  lastAction: EngineeringReviewAction | null;
  concept: string;
  identity: EngineeringKnowledgeIdentity;
  aliases: string[];
  evidence: string[];
  reviewNotes: string | null;
  reviewedBy: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
  projectCount: number;
  successfulComparisons: number;
  versionHistory: EngineeringKnowledgeVersionEntry[];
  createdAt: string;
  updatedAt: string;
};

type KnowledgeDelegate = {
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
};

function knowledgeDelegate(): KnowledgeDelegate | null {
  const delegate = (prisma as unknown as Record<string, unknown>)["engineeringKnowledgeEntry"];
  if (delegate && typeof (delegate as KnowledgeDelegate).findMany === "function") {
    return delegate as KnowledgeDelegate;
  }
  return null;
}

export function isEngineeringKnowledgeStoreAvailable(): boolean {
  return knowledgeDelegate() != null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asVersionHistory(value: unknown): EngineeringKnowledgeVersionEntry[] {
  return Array.isArray(value) ? (value as EngineeringKnowledgeVersionEntry[]) : [];
}

function toStored(row: Record<string, unknown>): StoredEngineeringKnowledge {
  return {
    knowledgeEntryId: typeof row.id === "string" ? row.id : null,
    fingerprint: String(row.fingerprint ?? ""),
    status: (row.status as TrustedKnowledgeStatus) ?? "DEVELOPER_APPROVED",
    lastAction: (row.lastAction as EngineeringReviewAction | null) ?? null,
    concept: String(row.concept ?? ""),
    identity: {
      discipline: (row.discipline as string | null) ?? null,
      engineeringObject: (row.engineeringObject as string | null) ?? null,
      engineeringWork: (row.engineeringWork as string | null) ?? null,
      deliverableType: (row.deliverableType as string | null) ?? null,
      lifecycleStage: (row.lifecycleStage as string | null) ?? null,
    },
    aliases: asStringArray(row.aliases),
    evidence: asStringArray(row.evidence),
    reviewNotes: (row.reviewNotes as string | null) ?? null,
    reviewedBy: (row.reviewedBy as string | null) ?? null,
    firstObservedAt: row.firstObservedAt instanceof Date
      ? row.firstObservedAt.toISOString()
      : String(row.firstObservedAt ?? new Date().toISOString()),
    lastObservedAt: row.lastObservedAt instanceof Date
      ? row.lastObservedAt.toISOString()
      : String(row.lastObservedAt ?? new Date().toISOString()),
    projectCount: Number(row.projectCount ?? 0),
    successfulComparisons: Number(row.successfulComparisons ?? 0),
    versionHistory: asVersionHistory(row.versionHistory),
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.firstObservedAt ?? new Date().toISOString()),
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : String(row.lastObservedAt ?? new Date().toISOString()),
  };
}

/** Load all persisted decisions for a company, keyed by fingerprint. Never throws. */
export async function loadEngineeringKnowledge(
  companyId: string
): Promise<Map<string, StoredEngineeringKnowledge>> {
  const delegate = knowledgeDelegate();
  if (!delegate) return new Map();
  try {
    const rows = await delegate.findMany({ where: { companyId } });
    const map = new Map<string, StoredEngineeringKnowledge>();
    for (const row of rows) {
      const stored = toStored(row);
      if (stored.fingerprint) map.set(stored.fingerprint, stored);
    }
    return map;
  } catch {
    return new Map();
  }
}

const STATUS_BY_ACTION: Record<EngineeringReviewAction, TrustedKnowledgeStatus> = {
  APPROVE: "DEVELOPER_APPROVED",
  MODIFY: "DEVELOPER_MODIFIED",
  REJECT: "REJECTED",
};

/**
 * Record a developer decision. Upserts by (companyId, fingerprint), appends to
 * the immutable version history, and returns the stored entry — or null if the
 * store is unavailable (so the caller can report that persistence is offline).
 */
export async function recordEngineeringReviewDecision(args: {
  companyId: string;
  fingerprint: string;
  action: EngineeringReviewAction;
  concept: string;
  identity: EngineeringKnowledgeIdentity;
  aliases?: string[];
  evidence?: string[];
  notes?: string | null;
  reviewedBy?: string | null;
  observed?: { projectCount?: number; successfulComparisons?: number; firstObservedAt?: string; lastObservedAt?: string };
}): Promise<StoredEngineeringKnowledge | null> {
  const delegate = knowledgeDelegate();
  if (!delegate) return null;

  const status = STATUS_BY_ACTION[args.action];
  const versions = getEngineeringBrainVersions();
  const now = new Date();
  const versionEntry: EngineeringKnowledgeVersionEntry = {
    at: now.toISOString(),
    action: args.action,
    status,
    reviewedBy: args.reviewedBy ?? null,
    identity: args.identity,
    notes: args.notes ?? null,
  };

  try {
    const existing = await delegate.findFirst({
      where: { companyId: args.companyId, fingerprint: args.fingerprint },
    });

    const identityFields = {
      discipline: args.identity.discipline,
      engineeringObject: args.identity.engineeringObject,
      engineeringWork: args.identity.engineeringWork,
      deliverableType: args.identity.deliverableType,
      lifecycleStage: args.identity.lifecycleStage,
    };

    if (existing) {
      const history = [...asVersionHistory(existing.versionHistory), versionEntry];
      const row = await delegate.update({
        where: { id: String(existing.id) },
        data: {
          status,
          lastAction: args.action,
          concept: args.concept,
          ...identityFields,
          aliases: args.aliases ?? asStringArray(existing.aliases),
          evidence: args.evidence ?? asStringArray(existing.evidence),
          reviewNotes: args.notes ?? null,
          reviewedBy: args.reviewedBy ?? null,
          lastObservedAt: args.observed?.lastObservedAt ?? now,
          projectCount: args.observed?.projectCount ?? Number(existing.projectCount ?? 0),
          successfulComparisons:
            args.observed?.successfulComparisons ?? Number(existing.successfulComparisons ?? 0),
          versionHistory: history,
          brainVersion: versions.brain,
          promptVersion: versions.reasoningPrompt,
          vocabularyVersion: versions.vocabulary,
          validationVersion: versions.validation,
        },
      });
      return toStored(row);
    }

    const row = await delegate.create({
      data: {
        companyId: args.companyId,
        fingerprint: args.fingerprint,
        status,
        lastAction: args.action,
        concept: args.concept,
        ...identityFields,
        aliases: args.aliases ?? [],
        evidence: args.evidence ?? [],
        reviewNotes: args.notes ?? null,
        reviewedBy: args.reviewedBy ?? null,
        firstObservedAt: args.observed?.firstObservedAt ?? now,
        lastObservedAt: args.observed?.lastObservedAt ?? now,
        projectCount: args.observed?.projectCount ?? 0,
        successfulComparisons: args.observed?.successfulComparisons ?? 0,
        versionHistory: [versionEntry],
        brainVersion: versions.brain,
        promptVersion: versions.reasoningPrompt,
        vocabularyVersion: versions.vocabulary,
        validationVersion: versions.validation,
      },
    });
    return toStored(row);
  } catch {
    return null;
  }
}
