/**
 * Schema 2.2.0 export enrichment — DEVELOPER ONLY.
 *
 * Adds observation metadata and round-trip decision stubs to brain export JSON.
 */
import type { StoredEngineeringKnowledge } from "./engineeringKnowledgeStore.service.js";
import type {
  BrainKnowledgeEntry,
  EngineeringBrainExportV2,
} from "./engineeringBrainExportMapper.service.js";
import type {
  BrainExportApprovalStatus,
  ExportObservationGrouping,
} from "./engineeringBrainExportGrouping.service.js";

export type BrainExportDecisionAction = "APPROVE" | "MODIFY" | "REJECT" | "NONE";

export type BrainExportDecision = {
  action: BrainExportDecisionAction;
  fields: {
    discipline: string | null;
    engineeringObject: string | null;
    engineeringWork: string | null;
    deliverableType: string | null;
    lifecycle: string | null;
    aliases: string[];
  };
};

export type EnrichedBrainKnowledgeEntry = BrainKnowledgeEntry & {
  observationCount: number;
  representativeDeliverableId: string | null;
  observationIds: string[];
  approvalStatus: BrainExportApprovalStatus;
  decision: BrainExportDecision;
};

export type EnrichedEngineeringBrainExport = EngineeringBrainExportV2 & {
  needsReview: EnrichedBrainKnowledgeEntry[];
  developerModified: EnrichedBrainKnowledgeEntry[];
  autoApproved: EnrichedBrainKnowledgeEntry[];
  trustedKnowledge: EnrichedBrainKnowledgeEntry[];
  rejected: EnrichedBrainKnowledgeEntry[];
};

export type EnrichedDeliverableObservation = Record<string, unknown> & {
  brainFingerprint: string;
  isRepresentative: boolean;
  representativeDeliverableId: string | null;
  observationIndex: number;
  observationCount: number;
};

function defaultDecisionFields(
  entry: BrainKnowledgeEntry,
  stored: StoredEngineeringKnowledge | undefined
): BrainExportDecision["fields"] {
  return {
    discipline: entry.discipline.id,
    engineeringObject: entry.engineeringObject.id,
    engineeringWork: entry.engineeringWork.id,
    deliverableType: entry.deliverableType.id,
    lifecycle: entry.lifecycle.id,
    aliases: stored?.aliases?.length ? stored.aliases : entry.supportingAliases,
  };
}

function defaultDecision(
  entry: BrainKnowledgeEntry,
  stored: StoredEngineeringKnowledge | undefined
): BrainExportDecision {
  return {
    action: "NONE",
    fields: defaultDecisionFields(entry, stored),
  };
}

function enrichEntry(
  entry: BrainKnowledgeEntry,
  grouping: ExportObservationGrouping,
  decisions: Map<string, StoredEngineeringKnowledge>
): EnrichedBrainKnowledgeEntry {
  const group = grouping.byFingerprint.get(entry.fingerprint);
  const stored = decisions.get(entry.fingerprint);
  const observationIds = group
    ? group.members.map((m) => m.deliverableId).filter((id): id is string => Boolean(id))
    : entry.deliverableId
      ? [entry.deliverableId]
      : [];

  return {
    ...entry,
    approvalStatus: group?.approvalStatus ?? (entry.approvalStatus as BrainExportApprovalStatus),
    observationCount: group?.observationCount ?? 1,
    representativeDeliverableId: group?.representative.deliverableId ?? entry.deliverableId,
    observationIds,
    decision: defaultDecision(entry, stored),
  };
}

function enrichBucket(
  entries: BrainKnowledgeEntry[],
  grouping: ExportObservationGrouping,
  decisions: Map<string, StoredEngineeringKnowledge>
): EnrichedBrainKnowledgeEntry[] {
  return entries.map((entry) => enrichEntry(entry, grouping, decisions));
}

export function enrichBrainExportV2_2(
  brain: EngineeringBrainExportV2,
  grouping: ExportObservationGrouping,
  decisions: Map<string, StoredEngineeringKnowledge> = new Map()
): EnrichedEngineeringBrainExport {
  return {
    ...brain,
    needsReview: enrichBucket(brain.needsReview, grouping, decisions),
    autoApproved: enrichBucket(brain.autoApproved, grouping, decisions),
    trustedKnowledge: enrichBucket(brain.trustedKnowledge, grouping, decisions),
    developerModified: enrichBucket(brain.developerModified, grouping, decisions),
    rejected: enrichBucket(brain.rejected, grouping, decisions),
  };
}

export function enrichDeliverableObservations(
  deliverables: Record<string, unknown>[],
  grouping: ExportObservationGrouping
): EnrichedDeliverableObservation[] {
  return deliverables.map((raw) => {
    const key = String(raw.key ?? "");
    const linked = grouping.byObservationKey.get(key);
    const fingerprint = String(raw.fingerprint ?? linked?.group.fingerprint ?? "");
    const group = linked?.group ?? (fingerprint ? grouping.byFingerprint.get(fingerprint) : undefined);
    const member = linked?.member;
    return {
      ...raw,
      brainFingerprint: fingerprint,
      isRepresentative: member?.isRepresentative ?? true,
      representativeDeliverableId: group?.representative.deliverableId ?? (raw.deliverableId as string | null) ?? null,
      observationIndex: member?.observationIndex ?? 0,
      observationCount: group?.observationCount ?? 1,
    };
  });
}
