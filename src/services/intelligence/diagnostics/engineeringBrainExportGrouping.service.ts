/**
 * Export-only observation grouping for schema 2.2.0 — DEVELOPER ONLY.
 *
 * Builds fingerprint → observation metadata for round-trip export enrichment.
 * Does not change production Brain aggregation.
 */
import type { EngineeringIdentity } from "../taxonomy/engineeringIdentity.service.js";
import { engineeringIdentityFingerprint } from "../taxonomy/engineeringTrust.service.js";
import type {
  EngineeringBrainDiagnosticsReport,
  EngineeringBrainSummary,
} from "./engineeringBrainDiagnostics.service.js";
import { subjectKeyFromName } from "./engineeringIdentityDebugQuality.js";

export type BrainExportApprovalStatus =
  | "NEEDS_REVIEW"
  | "AUTO_APPROVED"
  | "DEVELOPER_APPROVED"
  | "DEVELOPER_MODIFIED"
  | "REJECTED";

export type ExportObservationMember = {
  observationKey: string;
  deliverableId: string | null;
  deliverableName: string;
  observationIndex: number;
  isRepresentative: boolean;
  projectId: string;
  projectName: string;
  snapshotId: string | null;
  importVersion: number | null;
  importedAt: string | null;
};

export type ExportObservationGroup = {
  fingerprint: string;
  identity: {
    discipline: string | null;
    engineeringObject: string | null;
    engineeringWork: string | null;
    deliverableType: string | null;
    lifecycle: string | null;
  };
  approvalStatus: BrainExportApprovalStatus;
  observationCount: number;
  representative: ExportObservationMember;
  members: ExportObservationMember[];
};

export type ExportRootSummary = {
  deliverableObservations: number;
  uniqueEngineeringIdentities: number;
  groupedObservations: number;
  brainInbox: number;
  trustedKnowledge: number;
  autoApproved: number;
  developerApproved: number;
  developerModified: number;
  rejected: number;
};

export type ExportObservationGrouping = {
  groups: ExportObservationGroup[];
  byFingerprint: Map<string, ExportObservationGroup>;
  byObservationKey: Map<string, { group: ExportObservationGroup; member: ExportObservationMember }>;
};

type ResolvedObservation = {
  observed: {
    key: string;
    id: string | null | undefined;
    name: string;
    projectId: string;
    projectName: string;
    snapshotId: string | null | undefined;
    importVersion: number | null | undefined;
    importedAt: string | null | undefined;
  };
  identity: EngineeringIdentity;
};

function approvalStatusForFingerprint(
  fingerprint: string,
  report: EngineeringBrainDiagnosticsReport
): BrainExportApprovalStatus {
  const { collections } = report;
  if (collections.rejected.some((e) => e.fingerprint === fingerprint)) return "REJECTED";
  if (collections.developerModified.some((e) => e.fingerprint === fingerprint)) {
    return "DEVELOPER_MODIFIED";
  }
  if (collections.developerApproved.some((e) => e.fingerprint === fingerprint)) {
    return "DEVELOPER_APPROVED";
  }
  if (collections.autoApproved.some((e) => e.fingerprint === fingerprint)) return "AUTO_APPROVED";
  if (collections.needsReview.some((e) => e.fingerprint === fingerprint)) return "NEEDS_REVIEW";
  return "NEEDS_REVIEW";
}

function identityFields(identity: EngineeringIdentity): ExportObservationGroup["identity"] {
  return {
    discipline: identity.discipline.id,
    engineeringObject: identity.engineeringObject.id,
    engineeringWork: identity.engineeringWork.id,
    deliverableType: identity.deliverableType.id,
    lifecycle: identity.lifecycleStage.id,
  };
}

/** Build fingerprint groups from resolved observations (export scope). */
export function buildExportObservationGrouping(
  resolved: ResolvedObservation[],
  report: EngineeringBrainDiagnosticsReport
): ExportObservationGrouping {
  const buckets = new Map<string, ResolvedObservation[]>();
  for (const row of resolved) {
    const fp = engineeringIdentityFingerprint(subjectKeyFromName(row.observed.name), row.identity);
    const list = buckets.get(fp) ?? [];
    list.push(row);
    buckets.set(fp, list);
  }

  const groups: ExportObservationGroup[] = [];
  const byFingerprint = new Map<string, ExportObservationGroup>();
  const byObservationKey = new Map<
    string,
    { group: ExportObservationGroup; member: ExportObservationMember }
  >();

  for (const [fingerprint, rows] of buckets) {
    const members: ExportObservationMember[] = rows.map((row, index) => ({
      observationKey: row.observed.key,
      deliverableId: row.observed.id ?? null,
      deliverableName: row.observed.name,
      observationIndex: index,
      isRepresentative: index === 0,
      projectId: row.observed.projectId,
      projectName: row.observed.projectName,
      snapshotId: row.observed.snapshotId ?? null,
      importVersion: row.observed.importVersion ?? null,
      importedAt: row.observed.importedAt ?? null,
    }));

    const group: ExportObservationGroup = {
      fingerprint,
      identity: identityFields(rows[0].identity),
      approvalStatus: approvalStatusForFingerprint(fingerprint, report),
      observationCount: members.length,
      representative: members[0],
      members,
    };
    groups.push(group);
    byFingerprint.set(fingerprint, group);
    for (const member of members) {
      byObservationKey.set(member.observationKey, { group, member });
    }
  }

  groups.sort((a, b) => b.observationCount - a.observationCount || a.fingerprint.localeCompare(b.fingerprint));

  return { groups, byFingerprint, byObservationKey };
}

export function buildExportRootSummary(args: {
  observationCount: number;
  grouping: ExportObservationGrouping;
  brainSummary: EngineeringBrainSummary;
}): ExportRootSummary {
  const uniqueEngineeringIdentities = args.grouping.groups.length;
  const groupedObservations = Math.max(0, args.observationCount - uniqueEngineeringIdentities);
  return {
    deliverableObservations: args.observationCount,
    uniqueEngineeringIdentities,
    groupedObservations,
    brainInbox: args.brainSummary.brainInbox,
    trustedKnowledge: args.brainSummary.trustedKnowledge,
    autoApproved: args.brainSummary.autoApproved,
    developerApproved: args.brainSummary.developerApproved,
    developerModified: args.brainSummary.developerModified,
    rejected: args.brainSummary.rejected,
  };
}
