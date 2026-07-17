/**
 * EngineeringBrainExportMapper — DEVELOPER ONLY.
 *
 * Pure serialization: EngineeringBrainDiagnosticsReport → export JSON shape.
 * No grouping, filtering, deduplication, or status computation.
 */
import type {
  BrainInboxItem,
  EngineeringBrainDiagnosticsReport,
  EngineeringBrainSummary,
  TrustedKnowledgeEntry,
} from "./engineeringBrainDiagnostics.service.js";
import type { EngineeringComponentView } from "./engineeringBrainReview.js";
import type { StoredEngineeringKnowledge } from "./engineeringKnowledgeStore.service.js";
import { validateBrainUiParity } from "./engineeringBrainParity.service.js";

export type BrainIdentityComponent = {
  id: string | null;
  label: string | null;
  confidence: number;
  evidence: Array<{ source: string; value: string; matched: string }>;
};

export type BrainKnowledgeEntry = {
  id: string;
  knowledgeEntryId: string | null;
  status: string;
  approvalStatus: string;
  project: { id: string | null; name: string } | null;
  import: {
    version: number | null;
    importedAt: string | null;
    snapshotId: string | null;
  } | null;
  fragnet: { id: string | null; name: string | null };
  parentWbs: string | null;
  wbsPath: string | null;
  deliverableName: string;
  deliverableId: string | null;
  fingerprint: string;
  discipline: BrainIdentityComponent;
  engineeringObject: BrainIdentityComponent;
  engineeringWork: BrainIdentityComponent;
  deliverableType: BrainIdentityComponent;
  lifecycle: BrainIdentityComponent;
  projectContext: BrainIdentityComponent;
  supportingAliases: string[];
  historicalMatches: unknown[];
  relatedActivities: unknown[];
  neighbouringDeliverables: {
    sameWbs: string[];
    sameFragnet: string[];
    precedingDeliverables: null;
    followingDeliverables: null;
    sharedActivities: null;
    relationshipWeights: null;
  };
  reasoning: {
    why: unknown[];
    trustReasons: string[];
    taxonomyDiagnostics: unknown;
    summary: string;
    whyNeedsReview: unknown[];
    reviewReasons: unknown[];
  };
  confidence: {
    overall: number;
    trust: number;
    components: Record<string, number>;
    risk: string;
    riskScore: number;
  };
  confidenceBreakdown: unknown;
  ruleTrace: unknown[];
  provenance: unknown;
  validation: {
    identity: unknown;
    export: unknown;
    contradictions: unknown[];
  };
  decisionHistory: unknown[];
  createdAt: string;
  updatedAt: string;
  detail: unknown;
};

export type EngineeringBrainExportV2 = {
  needsReview: BrainKnowledgeEntry[];
  developerModified: BrainKnowledgeEntry[];
  autoApproved: BrainKnowledgeEntry[];
  /** Developer-approved entries (`collections.developerApproved`). */
  trustedKnowledge: BrainKnowledgeEntry[];
  rejected: BrainKnowledgeEntry[];
  summary: {
    total: number;
    needsReview: number;
    developerModified: number;
    autoApproved: number;
    trustedKnowledge: number;
    rejected: number;
    totalIncludingRejected: number;
  };
  ui: {
    brainInbox: number;
    trustedKnowledge: number;
    totalVisible: number;
  };
  source: "EngineeringBrainDiagnosticsReport";
  uiParity: boolean;
};

function componentFromView(view: EngineeringComponentView | undefined): BrainIdentityComponent {
  if (!view) return { id: null, label: null, confidence: 0, evidence: [] };
  return {
    id: view.id,
    label: view.label,
    confidence: view.confidence,
    evidence: view.evidence,
  };
}

function componentFromIds(
  id: string | null,
  evidence: string[] = []
): BrainIdentityComponent {
  return {
    id,
    label: id,
    confidence: id ? 100 : 0,
    evidence: evidence.map((e) => ({ source: "STORED", value: e, matched: e })),
  };
}

function timestamps(
  stored: StoredEngineeringKnowledge | undefined,
  fallbackFirst: string,
  fallbackLast: string
): { createdAt: string; updatedAt: string } {
  if (stored) {
    return { createdAt: stored.createdAt, updatedAt: stored.updatedAt };
  }
  return { createdAt: fallbackFirst, updatedAt: fallbackLast };
}

function inboxSummary(item: BrainInboxItem): string {
  const parts = [
    `${item.concept} — ${item.state}`,
    `${item.occurrences} observation(s) across ${item.projects} project(s)`,
  ];
  if (item.reasons.length) parts.push(`Reasons: ${item.reasons.join(", ")}`);
  return parts.join(". ");
}

function trustedSummary(entry: TrustedKnowledgeEntry): string {
  return `${entry.concept} — ${entry.status}. Seen in ${entry.projectCount} project(s), ${entry.successfulComparisons} equivalent comparison(s).`;
}

export function mapInboxItemToBrainEntry(
  item: BrainInboxItem,
  stored: StoredEngineeringKnowledge | undefined
): BrainKnowledgeEntry {
  const view = item.identityView;
  const { createdAt, updatedAt } = timestamps(stored, new Date().toISOString(), new Date().toISOString());

  return {
    id: item.fingerprint,
    knowledgeEntryId: stored?.knowledgeEntryId ?? null,
    status: item.state,
    approvalStatus: "NEEDS_REVIEW",
    project: item.context
      ? { id: null, name: item.context.projectName }
      : { id: null, name: item.projectName },
    import: null,
    fragnet: { id: null, name: item.context?.fragnetName ?? null },
    parentWbs: item.context?.parentWbs ?? null,
    wbsPath: item.context?.wbsPath ?? null,
    deliverableName: item.context?.deliverableName ?? item.exampleDeliverableName,
    deliverableId: null,
    fingerprint: item.fingerprint,
    discipline: componentFromView(view.discipline),
    engineeringObject: componentFromView(view.engineeringObject),
    engineeringWork: componentFromView(view.engineeringWork),
    deliverableType: componentFromView(view.deliverableType),
    lifecycle: componentFromView(view.lifecycleStage),
    projectContext: componentFromView(view.projectContext),
    supportingAliases: stored?.aliases ?? [],
    historicalMatches: item.historicalMatches,
    relatedActivities: item.context?.relatedActivities ?? [],
    neighbouringDeliverables: {
      sameWbs: item.context?.neighbouringDeliverables ?? [],
      sameFragnet: item.context?.neighbouringDeliverables ?? [],
      precedingDeliverables: null,
      followingDeliverables: null,
      sharedActivities: null,
      relationshipWeights: null,
    },
    reasoning: {
      why: item.why,
      trustReasons: item.reasons,
      taxonomyDiagnostics: null,
      summary: inboxSummary(item),
      whyNeedsReview: item.reasonDetails,
      reviewReasons: item.reasonDetails,
    },
    confidence: {
      overall: view.overallConfidence,
      trust: item.confidence,
      components: {
        discipline: view.discipline.confidence,
        engineeringObject: view.engineeringObject.confidence,
        engineeringWork: view.engineeringWork.confidence,
        deliverableType: view.deliverableType.confidence,
        lifecycle: view.lifecycleStage.confidence,
        projectContext: view.projectContext.confidence,
      },
      risk: item.state === "CONTRADICTORY" ? "High" : "Medium",
      riskScore: item.state === "CONTRADICTORY" ? 0.7 : 0.4,
    },
    confidenceBreakdown: null,
    ruleTrace: [],
    provenance: {
      source: "EngineeringBrainDiagnosticsReport",
      collection: "collections.needsReview",
      occurrences: item.occurrences,
      projects: item.projects,
      evidence: item.evidence,
    },
    validation: {
      identity: { status: view.status },
      export: { valid: true, errors: [], warnings: [] },
      contradictions: item.state === "CONTRADICTORY" ? item.reasonDetails : [],
    },
    decisionHistory: stored?.versionHistory ?? [],
    createdAt,
    updatedAt,
    detail: item,
  };
}

export function mapTrustedEntryToBrainEntry(
  entry: TrustedKnowledgeEntry,
  stored: StoredEngineeringKnowledge | undefined
): BrainKnowledgeEntry {
  const view = entry.identityView;
  const { createdAt, updatedAt } = timestamps(stored, entry.firstObserved, entry.lastObserved);

  const discipline = view
    ? componentFromView(view.discipline)
    : componentFromIds(entry.identity.discipline, entry.evidence);
  const engineeringObject = view
    ? componentFromView(view.engineeringObject)
    : componentFromIds(entry.identity.engineeringObject, entry.evidence);
  const engineeringWork = view
    ? componentFromView(view.engineeringWork)
    : componentFromIds(entry.identity.engineeringWork, entry.evidence);
  const deliverableType = view
    ? componentFromView(view.deliverableType)
    : componentFromIds(entry.identity.deliverableType, entry.evidence);
  const lifecycle = view
    ? componentFromView(view.lifecycleStage)
    : componentFromIds(entry.identity.lifecycleStage, entry.evidence);
  const projectContext = view ? componentFromView(view.projectContext) : componentFromIds(null);

  return {
    id: entry.fingerprint,
    knowledgeEntryId: stored?.knowledgeEntryId ?? null,
    status: entry.status === "REJECTED" ? "CONTRADICTORY" : "TRUSTED",
    approvalStatus: entry.status,
    project: entry.context ? { id: null, name: entry.context.projectName } : null,
    import: {
      version: null,
      importedAt: entry.firstObserved,
      snapshotId: null,
    },
    fragnet: { id: null, name: entry.context?.fragnetName ?? null },
    parentWbs: entry.context?.parentWbs ?? null,
    wbsPath: entry.context?.wbsPath ?? null,
    deliverableName: entry.context?.deliverableName ?? entry.concept,
    deliverableId: null,
    fingerprint: entry.fingerprint,
    discipline,
    engineeringObject,
    engineeringWork,
    deliverableType,
    lifecycle,
    projectContext,
    supportingAliases: entry.aliases,
    historicalMatches: entry.historicalMatches,
    relatedActivities: entry.context?.relatedActivities ?? [],
    neighbouringDeliverables: {
      sameWbs: entry.context?.neighbouringDeliverables ?? [],
      sameFragnet: entry.context?.neighbouringDeliverables ?? [],
      precedingDeliverables: null,
      followingDeliverables: null,
      sharedActivities: null,
      relationshipWeights: null,
    },
    reasoning: {
      why: [],
      trustReasons: [],
      taxonomyDiagnostics: null,
      summary: trustedSummary(entry),
      whyNeedsReview: [],
      reviewReasons: [],
    },
    confidence: {
      overall: view?.overallConfidence ?? 100,
      trust: entry.status === "REJECTED" ? 0 : 100,
      components: {
        discipline: discipline.confidence,
        engineeringObject: engineeringObject.confidence,
        engineeringWork: engineeringWork.confidence,
        deliverableType: deliverableType.confidence,
        lifecycle: lifecycle.confidence,
        projectContext: projectContext.confidence,
      },
      risk: entry.status === "REJECTED" ? "High" : "Low",
      riskScore: entry.status === "REJECTED" ? 0.8 : 0.1,
    },
    confidenceBreakdown: null,
    ruleTrace: [],
    provenance: {
      source: "EngineeringBrainDiagnosticsReport",
      collection: "collections.trusted",
      projectCount: entry.projectCount,
      successfulComparisons: entry.successfulComparisons,
      evidence: entry.evidence,
      examples: entry.examples,
    },
    validation: {
      identity: view ? { status: view.status } : null,
      export: {
        valid: true,
        errors: [],
        warnings: entry.context ? [] : ["Knowledge-only — no live observation in current scope"],
      },
      contradictions: [],
    },
    decisionHistory: entry.versionHistory,
    createdAt,
    updatedAt,
    detail: entry,
  };
}

function mapSummaryToExport(summary: EngineeringBrainSummary): EngineeringBrainExportV2["summary"] {
  return {
    total: summary.totalVisible,
    needsReview: summary.brainInbox,
    autoApproved: summary.autoApproved,
    trustedKnowledge: summary.developerApproved,
    developerModified: summary.developerModified,
    rejected: summary.rejected,
    totalIncludingRejected: summary.totalIncludingRejected,
  };
}

function lookup(
  decisions: Map<string, StoredEngineeringKnowledge>,
  fingerprint: string
): StoredEngineeringKnowledge | undefined {
  return decisions.get(fingerprint);
}

/**
 * Map canonical diagnostics → export JSON. No aggregation logic.
 */
export function mapDiagnosticsReportToBrainExportV2(
  report: EngineeringBrainDiagnosticsReport,
  decisions: Map<string, StoredEngineeringKnowledge> = new Map()
): EngineeringBrainExportV2 {
  const { collections } = report;

  const needsReview = collections.needsReview.map((item) =>
    mapInboxItemToBrainEntry(item, lookup(decisions, item.fingerprint))
  );
  const autoApproved = collections.autoApproved.map((entry) =>
    mapTrustedEntryToBrainEntry(entry, lookup(decisions, entry.fingerprint))
  );
  const trustedKnowledge = collections.developerApproved.map((entry) =>
    mapTrustedEntryToBrainEntry(entry, lookup(decisions, entry.fingerprint))
  );
  const developerModified = collections.developerModified.map((entry) =>
    mapTrustedEntryToBrainEntry(entry, lookup(decisions, entry.fingerprint))
  );
  const rejected = collections.rejected.map((entry) =>
    mapTrustedEntryToBrainEntry(entry, lookup(decisions, entry.fingerprint))
  );

  const exportBrain: EngineeringBrainExportV2 = {
    needsReview,
    autoApproved,
    trustedKnowledge,
    developerModified,
    rejected,
    summary: mapSummaryToExport(report.summary),
    ui: {
      brainInbox: report.summary.brainInbox,
      trustedKnowledge: report.summary.trustedKnowledge,
      totalVisible: report.summary.totalVisible,
    },
    source: "EngineeringBrainDiagnosticsReport",
    uiParity: false,
  };

  exportBrain.uiParity = validateBrainUiParity(exportBrain, report).valid;
  return exportBrain;
}

/** @deprecated Use mapDiagnosticsReportToBrainExportV2 */
export const EngineeringBrainExportMapper = {
  toExportV2: mapDiagnosticsReportToBrainExportV2,
};
