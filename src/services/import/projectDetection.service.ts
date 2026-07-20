import { parseXerProgramme, parseXerTables } from "../intelligence/shared/xerParse.service.js";
import { isP6MilestoneType } from "../p6TaskType.service.js";
import type { ImportedActivityRow } from "../intelligence/shared/types.js";
import type {
  ComplexityDetail,
  DetectedField,
  DetectionConfidence,
  DetectionSourceKind,
  FieldTrace,
  KeywordHit,
  KeywordMatchEvidence,
  ProjectDetectionReadiness,
  ProjectDetectionResult,
  SourceSearchResult,
  XerDetectionInput,
} from "./projectDetection.types.js";

export { isGenericProgrammeLabel, meaningfulFilenameTitle } from "./projectDetection.naming.js";
export type {
  ComplexityDetail,
  DetectedField,
  DetectionConfidence,
  DetectionSourceKind,
  ExpectedProjectMetadata,
  ExpectedResultsFile,
  FieldTrace,
  FieldValidationResult,
  FieldValidationStatus,
  ProjectDetectionReadiness,
  ProjectDetectionResult,
  ValidationReport,
  DatasetValidationSummary,
  DetectionMetrics,
  XerDetectionInput,
} from "./projectDetection.types.js";

type WbsNode = { id: string; parentId: string | null; name: string };

import {
  CLIENT_VOCABULARY,
  SECTOR_CONFLICT_PAIRS,
  SECTOR_VOCABULARIES,
  STAGE_CONTENT_SIGNALS,
  type ClientPattern,
  type SectorVocabulary,
} from "./projectDetection.vocabulary.js";

type SearchCorpus = {
  projectMetadata: string[];
  projectProperties: string[];
  wbs: string[];
  activityNames: string[];
  activityDescriptions: string[];
  activityCodes: string[];
  calendars: string[];
  resources: string[];
  filename: string[];
  rootWbs: string[];
  relationshipSummary: {
    relationshipCount: number;
    linkedActivityCount: number;
    bridgeActivityCount: number;
    linkedBridgeActivityCount: number;
  };
};

const SOURCE_LABELS: Record<DetectionSourceKind, string> = {
  project_metadata: "Project metadata",
  project_properties: "Project properties",
  wbs: "WBS",
  activity_names: "Activity names",
  activity_descriptions: "Activity descriptions",
  activity_codes: "Activity codes",
  calendars: "Calendars",
  resources: "Resources",
  filename: "Filename",
};

/** Hierarchy weights — higher sources dominate scoring. */
const SOURCE_WEIGHTS: Record<DetectionSourceKind, number> = {
  project_metadata: 5,
  project_properties: 4,
  wbs: 3,
  activity_names: 2,
  activity_descriptions: 2,
  activity_codes: 1,
  calendars: 1,
  resources: 1,
  filename: 4,
};

import {
  isGenericProgrammeLabel,
  meaningfulFilenameTitle,
} from "./projectDetection.naming.js";

function getRootWbsTitle(tables: ReturnType<typeof parseXerTables>): string | null {
  const wbsTable = tables.get("PROJWBS");
  if (!wbsTable) return null;
  for (const r of wbsTable.rows) {
    if (String(r.proj_node_flag ?? "").toUpperCase() === "Y") {
      const name = String(r.wbs_name ?? r.wbs_short_name ?? "").trim();
      if (name && !isGenericProgrammeLabel(name)) return name;
    }
  }
  return null;
}

function countPatternHits(text: string, pattern: RegExp): number {
  return text.match(new RegExp(pattern.source, pattern.flags + "g"))?.length ?? 0;
}

function saturatedEvidenceCount(count: number): number {
  return count <= 0 ? 0 : 1 + Math.log2(count);
}

function scoreSectorVocabulary(
  corpus: SearchCorpus,
  vocab: SectorVocabulary,
  sources: DetectionSourceKind[]
): KeywordMatchEvidence {
  let totalScore = 0;
  let totalHits = 0;
  const matchedKeywords: KeywordHit[] = [];
  const usedSources = new Set<DetectionSourceKind>();
  const allPatterns = [...vocab.phrases, ...vocab.keywords];

  for (const source of sources) {
    const sourceWeight = SOURCE_WEIGHTS[source];
    for (const p of allPatterns) {
      const hits = corpusForSource(corpus, source).filter((item) => p.pattern.test(item)).length;
      if (!hits) continue;
      const phraseMultiplier = p.kind === "phrase" ? 1.5 : 1;
      const rootHits =
        source === "wbs" ? corpus.rootWbs.filter((item) => p.pattern.test(item)).length : 0;
      totalHits += hits;
      totalScore += saturatedEvidenceCount(hits) * p.weight * sourceWeight * phraseMultiplier;
      totalScore += rootHits * p.weight * 2;
      matchedKeywords.push({ pattern: p.label, count: hits, source });
      usedSources.add(source);
    }
  }

  const fullText = sources.flatMap((s) => corpusForSource(corpus, s)).join(" ").toLowerCase();
  for (const combo of vocab.combos ?? []) {
    if (combo.patterns.every((cp) => countPatternHits(fullText, cp) > 0)) {
      totalHits += 1;
      totalScore += combo.weight;
      matchedKeywords.push({ pattern: combo.label, count: 1, source: "activity_names" });
    }
  }

  if (usedSources.size > 1) {
    totalScore *= 1 + Math.min(0.3, (usedSources.size - 1) * 0.1);
  }

  return {
    label: vocab.sector,
    score: Math.round(totalScore),
    hits: totalHits,
    matchedKeywords,
    sources: [...usedSources],
  };
}

function applySectorConflictAdjustment(ranked: KeywordMatchEvidence[]): {
  adjusted: KeywordMatchEvidence[];
  conflictResolution: string[];
  ignored: KeywordMatchEvidence[];
} {
  const adjusted = ranked.map((r) => ({ ...r, score: r.score, matchedKeywords: [...r.matchedKeywords] }));
  const conflictResolution: string[] = [];
  const ignored: KeywordMatchEvidence[] = [];

  for (const [a, b] of SECTOR_CONFLICT_PAIRS) {
    const scoreA = adjusted.find((r) => r.label === a);
    const scoreB = adjusted.find((r) => r.label === b);
    if (!scoreA || !scoreB || scoreA.score < 8 || scoreB.score < 8) continue;

    const ratio = Math.min(scoreA.score, scoreB.score) / Math.max(scoreA.score, scoreB.score);
    if (ratio >= 0.35) {
      const weaker = scoreA.score <= scoreB.score ? scoreA : scoreB;
      const stronger = scoreA.score > scoreB.score ? scoreA : scoreB;
      const penalty = Math.round(weaker.score * 0.55);
      weaker.score = Math.max(0, weaker.score - penalty);
      conflictResolution.push(
        `${stronger.label} evidence reduced competing ${weaker.label} score by ${penalty} (${a} vs ${b} conflict).`
      );
      if (weaker.score < 8) ignored.push({ ...weaker });
    }
  }

  return {
    adjusted: adjusted.filter((r) => r.score > 0).sort((x, y) => y.score - x.score),
    conflictResolution,
    ignored,
  };
}

function scoreAllSectors(
  corpus: SearchCorpus,
  sources: DetectionSourceKind[]
): { ranked: KeywordMatchEvidence[]; conflictResolution: string[]; ignored: KeywordMatchEvidence[] } {
  const raw = SECTOR_VOCABULARIES.map((v) => scoreSectorVocabulary(corpus, v, sources)).filter((r) => r.hits > 0);
  const { adjusted, conflictResolution, ignored } = applySectorConflictAdjustment(raw);
  return { ranked: adjusted, conflictResolution, ignored };
}

function scoreClientVocabulary(
  corpus: SearchCorpus,
  client: ClientPattern,
  sources: DetectionSourceKind[]
): KeywordMatchEvidence {
  let totalScore = 0;
  let totalHits = 0;
  const matchedKeywords: KeywordHit[] = [];
  const usedSources = new Set<DetectionSourceKind>();

  for (const source of sources) {
    const sourceWeight = SOURCE_WEIGHTS[source];
    for (const p of client.patterns) {
      const hits = corpusForSource(corpus, source).filter((item) => p.pattern.test(item)).length;
      if (!hits) continue;
      const phraseMultiplier = p.kind === "phrase" ? 1.5 : 1;
      totalHits += hits;
      totalScore += saturatedEvidenceCount(hits) * p.weight * sourceWeight * phraseMultiplier;
      matchedKeywords.push({ pattern: p.pattern.source, count: hits, source });
      usedSources.add(source);
    }
  }

  if (usedSources.size > 1) {
    totalScore *= 1 + Math.min(0.2, (usedSources.size - 1) * 0.1);
  }

  return {
    label: client.label,
    score: Math.round(totalScore),
    hits: totalHits,
    matchedKeywords,
    sources: [...usedSources],
  };
}

function scoreStageContent(corpus: SearchCorpus): Record<string, number> {
  const items = deduplicateEvidence([
    ...corpus.projectMetadata,
    ...corpus.filename,
    ...corpus.wbs,
    ...corpus.activityNames,
    ...corpus.activityDescriptions,
    ...corpus.activityCodes,
    ...corpus.calendars,
    ...corpus.resources,
  ]);

  const commissioningExclusions = [/\bclinical\s+commissioning\b/i, /\bcommissioning\s+planning\b/i];

  const scores: Record<string, number> = {};
  for (const [stage, patterns] of Object.entries(STAGE_CONTENT_SIGNALS)) {
    let hits = 0;
    for (const p of patterns) {
      hits += saturatedEvidenceCount(items.filter((item) => p.test(item)).length);
    }
    if (stage === "commissioning") {
      for (const ex of commissioningExclusions) {
        hits -= saturatedEvidenceCount(items.filter((item) => ex.test(item)).length);
      }
    }
    scores[stage] = Math.max(0, Math.round(hits * 10) / 10);
  }
  return scores;
}

const COMPLEXITY_FACTORS = [
  { key: "activityCount", label: "Activities", breakpoints: [500, 2000, 5000], maxPoints: 18 },
  { key: "relationshipDensity", label: "Logic density", breakpoints: [0.5, 1.2, 2.0], maxPoints: 14 },
  { key: "wbsDepth", label: "WBS depth", breakpoints: [2, 4, 6], maxPoints: 10 },
  { key: "wbsCount", label: "WBS nodes", breakpoints: [10, 40, 100], maxPoints: 10 },
  { key: "calendarCount", label: "Calendars", breakpoints: [2, 5, 10], maxPoints: 8 },
  { key: "resourceCount", label: "Resources", breakpoints: [20, 100, 300], maxPoints: 8 },
  { key: "constraintCount", label: "Constraints", breakpoints: [5, 25, 75], maxPoints: 12 },
  { key: "workstreamCount", label: "Workstreams", breakpoints: [3, 8, 15], maxPoints: 10 },
] as const;

const COMPLEXITY_BANDS = [
  { maxScore: 25, label: "Low" },
  { maxScore: 50, label: "Medium" },
  { maxScore: 75, label: "High" },
  { maxScore: 100, label: "Very High" },
];

function tierPoints(value: number, breakpoints: number[], maxPoints: number): number {
  const steps = breakpoints.length + 1;
  const stepSize = maxPoints / steps;
  for (let i = 0; i < breakpoints.length; i++) {
    if (value < breakpoints[i]!) return stepSize * (i + 1);
  }
  return maxPoints;
}

function buildTrace(
  sourcesSearched: SourceSearchResult[],
  opts: Partial<Omit<FieldTrace, "sourcesSearched">> = {}
): FieldTrace {
  return {
    sourcesSearched,
    confidenceReasoning: opts.confidenceReasoning ?? "",
    evidenceSummary: opts.evidenceSummary ?? [],
    matchedKeywords: opts.matchedKeywords,
    rejectedMatches: opts.rejectedMatches,
    ignoredMatches: opts.ignoredMatches,
    conflictResolution: opts.conflictResolution,
    rawSignals: opts.rawSignals,
  };
}

function allSourceResults(corpus: SearchCorpus, includeFilename = false): SourceSearchResult[] {
  const entries: [DetectionSourceKind, string[]][] = [
    ["project_metadata", corpus.projectMetadata],
    ["project_properties", corpus.projectProperties],
    ["wbs", corpus.wbs],
    ["activity_names", corpus.activityNames],
    ["activity_descriptions", corpus.activityDescriptions],
    ["activity_codes", corpus.activityCodes],
    ["calendars", corpus.calendars],
    ["resources", corpus.resources],
  ];
  const results = entries.map(([kind, items]) => ({
    kind,
    label: SOURCE_LABELS[kind],
    searched: true,
    itemCount: items.length,
  }));
  if (includeFilename) {
    results.push({ kind: "filename", label: SOURCE_LABELS.filename, searched: true, itemCount: corpus.filename.length });
  }
  return results;
}

function emptyField(source: string, sourcesSearched: SourceSearchResult[], reasoning: string): DetectedField {
  return {
    value: null,
    confidence: "none",
    reason: "No confident match found in the programme.",
    source,
    needsConfirmation: true,
    trace: buildTrace(sourcesSearched, {
      confidenceReasoning: reasoning,
      evidenceSummary: ["No sufficient evidence to suggest a value."],
    }),
  };
}

function field(
  value: string | null,
  confidence: DetectionConfidence,
  reason: string,
  source: string,
  trace: FieldTrace
): DetectedField {
  return {
    value,
    confidence,
    reason,
    source,
    needsConfirmation: confidence === "low" || confidence === "none",
    trace,
  };
}

function buildWbsNodes(tables: ReturnType<typeof parseXerTables>): Map<string, WbsNode> {
  const wbsTable = tables.get("PROJWBS");
  const nodes = new Map<string, WbsNode>();
  if (!wbsTable) return nodes;
  for (const r of wbsTable.rows) {
    const id = String(r.wbs_id ?? "").trim();
    if (!id) continue;
    const parentRaw = String(r.parent_wbs_id ?? "").trim();
    nodes.set(id, {
      id,
      parentId: parentRaw && parentRaw !== id ? parentRaw : null,
      name: String(r.wbs_name ?? r.wbs_short_name ?? "").trim(),
    });
  }
  return nodes;
}

function findRootId(nodes: Map<string, WbsNode>): string | null {
  for (const [id, n] of nodes) {
    const p = n.parentId;
    if (!p || p === "0" || p === id) return id;
  }
  return nodes.has("1") ? "1" : nodes.size > 0 ? [...nodes.keys()][0]! : null;
}

function maxWbsDepth(nodes: Map<string, WbsNode>, rootId: string): number {
  const depthOf = (id: string): number => {
    const children = [...nodes.values()].filter((n) => n.parentId === id);
    if (children.length === 0) return 1;
    return 1 + Math.max(...children.map((c) => depthOf(c.id)));
  };
  return depthOf(rootId);
}

function countWorkstreams(nodes: Map<string, WbsNode>, rootId: string): number {
  return [...nodes.values()].filter((n) => n.parentId === rootId).length;
}

function buildSearchCorpus(
  tables: ReturnType<typeof parseXerTables>,
  activities: ImportedActivityRow[],
  fileName?: string
): SearchCorpus {
  const projectRow = tables.get("PROJECT")?.rows[0];
  const projectMetadata: string[] = [];
  const projectProperties: string[] = [];

  if (projectRow) {
    for (const key of ["proj_name", "proj_short_name", "wbs_name"]) {
      const v = String(projectRow[key] ?? "").trim();
      if (v) projectMetadata.push(v);
    }
    for (const key of ["proj_id", "plan_start_date", "plan_end_date", "last_recalc_date"]) {
      const v = String(projectRow[key] ?? "").trim();
      if (v) projectProperties.push(v);
    }
  }

  const exportTitle = fileName ? meaningfulFilenameTitle(fileName) : null;
  const filename = exportTitle ? [exportTitle] : [];

  const wbs: string[] = [];
  const rootWbs: string[] = [];
  const wbsTable = tables.get("PROJWBS");
  if (wbsTable) {
    for (const r of wbsTable.rows) {
      const name = String(r.wbs_name ?? r.wbs_short_name ?? "").trim();
      if (name) wbs.push(name);
      if (name && String(r.proj_node_flag ?? "").toUpperCase() === "Y") rootWbs.push(name);
    }
  }

  const activityNames: string[] = [];
  const activityDescriptions: string[] = [];
  const activityCodes: string[] = [];
  const taskTable = tables.get("TASK");
  if (taskTable) {
    for (const r of taskTable.rows) {
      const name = String(r.task_name ?? "").trim();
      const code = String(r.task_code ?? "").trim();
      const memo = String(r.task_descr ?? r.memo ?? "").trim();
      if (name) activityNames.push(name);
      if (code) activityCodes.push(code);
      if (memo) activityDescriptions.push(memo);
    }
  }
  for (const a of activities) {
    if (a.name) activityNames.push(a.name);
    activityCodes.push(a.activityCode);
  }

  for (const tableName of ["ACTVCODE", "ACTVTYPE", "UDFTYPE", "UDFVALUE"]) {
    const table = tables.get(tableName);
    if (!table) continue;
    for (const r of table.rows) {
      for (const key of [
        "actv_code_name",
        "actv_code_short_name",
        "actv_code_type",
        "actv_code_type_name",
        "udf_type_name",
        "udf_type_label",
        "udf_text",
      ]) {
        const value = String(r[key] ?? "").trim();
        if (value) activityCodes.push(value);
      }
    }
  }

  const calendars: string[] = [];
  const calTable = tables.get("CALENDAR");
  if (calTable) {
    for (const r of calTable.rows) {
      const name = String(r.clndr_name ?? "").trim();
      if (name) calendars.push(name);
    }
  }

  const resources: string[] = [];
  const rsrcTable = tables.get("RSRC");
  if (rsrcTable) {
    for (const r of rsrcTable.rows) {
      const name = String(r.rsrc_name ?? r.rsrc_short_name ?? "").trim();
      if (name) resources.push(name);
    }
  }

  const taskNamesById = new Map<string, string>();
  for (const r of taskTable?.rows ?? []) {
    const id = String(r.task_id ?? "").trim();
    const name = String(r.task_name ?? "").trim();
    if (id && name) taskNamesById.set(id, name);
  }
  const linkedIds = new Set<string>();
  for (const r of tables.get("TASKPRED")?.rows ?? []) {
    const taskId = String(r.task_id ?? "").trim();
    const predId = String(r.pred_task_id ?? "").trim();
    if (taskId) linkedIds.add(taskId);
    if (predId) linkedIds.add(predId);
  }
  const bridgeActivityIds = new Set(
    [...taskNamesById].filter(([, name]) => /\b(?:bridge|viaduct|abutment|bridge deck)\b/i.test(name)).map(([id]) => id)
  );
  const linkedBridgeActivityCount = [...bridgeActivityIds].filter((id) => linkedIds.has(id)).length;
  if (linkedIds.size > 0) {
    projectProperties.push(
      `Relationship structure: ${tables.get("TASKPRED")?.rows.length ?? 0} links across ${linkedIds.size} activities`
    );
  }

  return {
    projectMetadata: deduplicateEvidence(projectMetadata),
    projectProperties: deduplicateEvidence(projectProperties),
    wbs: deduplicateEvidence(wbs),
    activityNames: deduplicateEvidence(activityNames),
    activityDescriptions: deduplicateEvidence(activityDescriptions),
    activityCodes: deduplicateEvidence(activityCodes),
    calendars: deduplicateEvidence(calendars),
    resources: deduplicateEvidence(resources),
    filename: deduplicateEvidence(filename),
    rootWbs: deduplicateEvidence(rootWbs),
    relationshipSummary: {
      relationshipCount: tables.get("TASKPRED")?.rows.length ?? 0,
      linkedActivityCount: linkedIds.size,
      bridgeActivityCount: bridgeActivityIds.size,
      linkedBridgeActivityCount,
    },
  };
}

function deduplicateEvidence(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    const key = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function corpusForSource(corpus: SearchCorpus, source: DetectionSourceKind): string[] {
  switch (source) {
    case "project_metadata":
      return corpus.projectMetadata;
    case "project_properties":
      return corpus.projectProperties;
    case "wbs":
      return corpus.wbs;
    case "activity_names":
      return corpus.activityNames;
    case "activity_descriptions":
      return corpus.activityDescriptions;
    case "activity_codes":
      return corpus.activityCodes;
    case "calendars":
      return corpus.calendars;
    case "resources":
      return corpus.resources;
    case "filename":
      return corpus.filename;
  }
}

function calibrateKeywordConfidence(
  ranked: KeywordMatchEvidence[],
  opts: { minScore: number; strongScore: number; requireMultiSourceForHigh?: boolean }
): { confidence: DetectionConfidence; reasoning: string; conflict: boolean } {
  const top = ranked[0];
  if (!top || top.score < opts.minScore) {
    return { confidence: "none", reasoning: "Score below minimum threshold for detection.", conflict: false };
  }

  const second = ranked[1];
  const margin = second ? top.score - second.score : top.score;
  const ratio = second && second.score > 0 ? top.score / second.score : Infinity;
  const multiSectorConflict = ranked.filter((r) => r.score >= top.score * 0.35 && r.score >= 10).length >= 3;
  const conflict =
    second != null && (margin < 6 || ratio < 1.5 || multiSectorConflict);

  if (conflict) {
    const conflictDetail = multiSectorConflict
      ? `Multiple sectors score similarly (${ranked
          .slice(0, 4)
          .map((r) => `${r.label}:${r.score}`)
          .join(", ")}).`
      : `Conflicting evidence: ${top.label} (${top.score}) vs ${second!.label} (${second!.score}). Margin too small.`;
    return {
      confidence: "low",
      reasoning: `${conflictDetail} Needs confirmation.`,
      conflict: true,
    };
  }

  if (top.score >= opts.strongScore && top.hits >= 3 && margin >= 8) {
    if (opts.requireMultiSourceForHigh && top.sources.length < 2) {
      return {
        confidence: "medium",
        reasoning: "Strong keyword matches but limited source coverage — capped at medium confidence.",
        conflict: false,
      };
    }
    return { confidence: "high", reasoning: "Many strong keyword matches with clear margin over alternatives.", conflict: false };
  }
  if (top.score >= opts.minScore * 1.5 && margin >= 4) {
    return { confidence: "medium", reasoning: "Moderate keyword evidence with acceptable margin.", conflict: false };
  }
  return { confidence: "low", reasoning: "Weak or indirect keyword evidence.", conflict: false };
}

function detectProjectName(
  corpus: SearchCorpus,
  tables: ReturnType<typeof parseXerTables>,
  fileName: string
): DetectedField {
  const sources = allSourceResults(corpus, true);
  const projectRow = tables.get("PROJECT")?.rows[0];
  const longName = String(projectRow?.proj_name ?? "").trim();
  const shortName = String(projectRow?.proj_short_name ?? "").trim();
  const wbsMetaName = String(projectRow?.wbs_name ?? "").trim();
  const rootWbs = getRootWbsTitle(tables);
  const fileTitle = meaningfulFilenameTitle(fileName);
  const shortIsGeneric = isGenericProgrammeLabel(shortName);

  if (longName && !isGenericProgrammeLabel(longName)) {
    return field(
      longName.slice(0, 255),
      "high",
      "Taken from the Primavera project name (proj_name) in the XER export.",
      "Detected from Primavera project metadata.",
      buildTrace(sources, {
        confidenceReasoning: "Explicit Primavera project name in PROJECT table — highest priority source.",
        evidenceSummary: [`proj_name: "${longName}"`],
        rawSignals: { sourceUsed: "project_metadata", longName },
      })
    );
  }

  if (shortName && !shortIsGeneric) {
    return field(
      shortName.slice(0, 255),
      "high",
      "Taken from the Primavera short name (proj_short_name) in the XER export.",
      "Detected from Primavera project metadata.",
      buildTrace(sources, {
        confidenceReasoning: "Primavera short name is a meaningful project title.",
        evidenceSummary: [`proj_short_name: "${shortName}"`],
        rawSignals: { sourceUsed: "project_metadata", shortName },
      })
    );
  }

  if (wbsMetaName && !isGenericProgrammeLabel(wbsMetaName)) {
    return field(
      wbsMetaName.slice(0, 255),
      "medium",
      "Taken from project metadata (wbs_name) in the XER export.",
      "Detected from Primavera project metadata.",
      buildTrace(sources, {
        confidenceReasoning: "Project metadata wbs_name used — confirm this is the intended project name.",
        evidenceSummary: [`wbs_name: "${wbsMetaName}"`],
        rawSignals: { sourceUsed: "project_metadata", wbsMetaName },
      })
    );
  }

  if (shortIsGeneric && fileTitle) {
    return field(
      fileTitle,
      "medium",
      "Primavera short name was a generic programme ID — derived title from export filename.",
      "Detected from programme export filename.",
      buildTrace(sources, {
        confidenceReasoning:
          "proj_short_name looked like a generic file reference; composed a descriptive title from the export filename.",
        evidenceSummary: [
          `Rejected generic proj_short_name: "${shortName}"`,
          `Filename title: "${fileTitle}"`,
        ],
        rawSignals: { sourceUsed: "filename", shortName, fileTitle, fileName },
      })
    );
  }

  if (rootWbs) {
    return field(
      rootWbs.slice(0, 255),
      "medium",
      "Taken from the root WBS node (proj_node_flag) in the XER export.",
      "Detected from Primavera WBS metadata.",
      buildTrace(sources, {
        confidenceReasoning: "Root WBS title used when project name fields were missing or generic.",
        evidenceSummary: [`Root WBS: "${rootWbs}"`],
        rawSignals: { sourceUsed: "wbs", rootWbs },
      })
    );
  }

  if (fileTitle) {
    return field(
      fileTitle,
      "low",
      "No valid Primavera project name detected. Title derived from export filename.",
      "Detected from filename (needs confirmation).",
      buildTrace(sources, {
        confidenceReasoning: "Filename used as last resort after metadata and WBS titles were unavailable.",
        evidenceSummary: [`Filename title: "${fileTitle}"`],
        rawSignals: { sourceUsed: "filename", fileName },
      })
    );
  }

  const stem = fileName.replace(/\.xer$/i, "").replace(/[_-]+/g, " ").trim();
  if (stem && stem.length > 2) {
    return field(
      stem.slice(0, 255),
      "low",
      "No valid Primavera project name detected. Filename used as fallback.",
      "Detected from filename (needs confirmation).",
      buildTrace(sources, {
        confidenceReasoning: "Raw filename stem used — needs confirmation.",
        evidenceSummary: [`Filename stem: "${stem}"`],
        rawSignals: { sourceUsed: "filename", fileName },
      })
    );
  }

  return emptyField("Could not detect a project name.", sources, "No metadata, WBS title, or usable filename.");
}

function detectClient(corpus: SearchCorpus, projectTitle: string): DetectedField {
  const sources = allSourceResults(corpus, true);
  const clientSources: DetectionSourceKind[] = [
    "project_metadata",
    "filename",
    "project_properties",
    "wbs",
    "activity_names",
    "activity_descriptions",
    "activity_codes",
  ];

  const titleBoost = projectTitle.trim().toLowerCase();
  const boostedCorpus: SearchCorpus = {
    ...corpus,
    projectMetadata: deduplicateEvidence([...corpus.projectMetadata, ...(titleBoost ? [titleBoost] : [])]),
  };

  const ranked = CLIENT_VOCABULARY.map((c) => scoreClientVocabulary(boostedCorpus, c, clientSources))
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.score - a.score);

  let top = ranked[0];
  const nhsCandidate = ranked.find((candidate) => candidate.label === "NHS Trust");
  if (nhsCandidate) {
    const explicitNhsEvidence = nhsCandidate.matchedKeywords.some(
      (hit) => hit.pattern !== "\\btrust\\b"
    );
    const hospitalRoot = corpus.rootWbs.some((item) => /\b(?:hospital|healthcare|clinical)\b/i.test(item));
    const healthcareProgrammeIdentity = [...corpus.projectMetadata, ...corpus.rootWbs].some((item) =>
      /\b(?:hospital|healthcare|clinical)\b/i.test(item)
    );
    const distinctTrustReferences = deduplicateEvidence([
      ...corpus.projectMetadata,
      ...corpus.wbs,
      ...corpus.activityNames,
      ...corpus.activityDescriptions,
      ...corpus.activityCodes,
    ]).filter((item) => /\btrust\b/i.test(item)).length;
    if (!explicitNhsEvidence && (!hospitalRoot || distinctTrustReferences < 2)) {
      ranked.splice(ranked.indexOf(nhsCandidate), 1);
      top = ranked[0];
    } else if (!explicitNhsEvidence) {
      nhsCandidate.score += 8;
      nhsCandidate.hits += 1;
      nhsCandidate.matchedKeywords.push({
        pattern: "hospital root + repeated Trust references",
        count: 1,
        source: "wbs",
      });
      ranked.sort((a, b) => b.score - a.score);
      top = ranked[0];
    } else if (healthcareProgrammeIdentity && nhsCandidate.score < 16) {
      nhsCandidate.score += 6;
      ranked.sort((a, b) => b.score - a.score);
      top = ranked[0];
    }
  }

  if (!top) {
    return emptyField(
      "Client left blank intentionally — no client evidence in the programme.",
      sources,
      "No client references were found in the Primavera project metadata, WBS, activity names, descriptions or codes. Manual confirmation is recommended."
    );
  }

  const { confidence, reasoning, conflict } = calibrateKeywordConfidence(ranked, {
    minScore: 10,
    strongScore: 22,
    requireMultiSourceForHigh: true,
  });

  if (confidence === "none" || confidence === "low") {
    return field(
      null,
      confidence === "none" ? "none" : "low",
      conflict
        ? `Possible ${top.label} but conflicting client signals — needs confirmation.`
        : "Client evidence was inconclusive — manual confirmation is recommended.",
      "Needs confirmation.",
      buildTrace(sources, {
        matchedKeywords: ranked.slice(0, 3),
        rejectedMatches: ranked.slice(1, 5),
        confidenceReasoning: reasoning,
        evidenceSummary: [`Best match: ${top.label} (score ${top.score})`],
      })
    );
  }

  return field(
    top.label,
    confidence,
    `Detected from ${top.hits} client reference${top.hits === 1 ? "" : "s"} across project title, WBS, and activities.`,
    "Detected from project information.",
    buildTrace(sources, {
      matchedKeywords: [top],
      rejectedMatches: ranked.slice(1, 5),
      confidenceReasoning: reasoning,
      evidenceSummary: top.matchedKeywords.slice(0, 5).map((k) => `${k.pattern} ×${k.count} (${k.source})`),
    })
  );
}

function detectProjectType(corpus: SearchCorpus): DetectedField {
  const sources = allSourceResults(corpus, true);
  const typeSources: DetectionSourceKind[] = [
    "project_metadata",
    "filename",
    "project_properties",
    "wbs",
    "activity_names",
    "activity_descriptions",
    "activity_codes",
  ];

  const { ranked, conflictResolution, ignored } = scoreAllSectors(corpus, typeSources);
  const rootText = corpus.rootWbs.join(" ");
  const programmeIdentity = [...corpus.projectMetadata, ...corpus.filename, ...corpus.rootWbs].join(" ");
  const healthcareRoot = /\b(?:hospital|healthcare|clinical|nhs)\b/i.test(rootText);
  const bridgeProgrammeIdentity = /\b(?:bridge|viaduct)\b/i.test(programmeIdentity);
  const healthcare = ranked.find((candidate) => candidate.label === "Healthcare");
  const bridge = ranked.find((candidate) => candidate.label === "Bridge");

  if (healthcareRoot && healthcare) {
    healthcare.score += 30;
    healthcare.hits += 1;
    healthcare.matchedKeywords.push({ pattern: "healthcare programme root", count: 1, source: "wbs" });
    conflictResolution.push("Healthcare programme root received programme-identity consensus weight.");
  }
  if (healthcareRoot && bridge && !bridgeProgrammeIdentity) {
    const originalScore = bridge.score;
    bridge.score = Math.round(bridge.score * 0.2);
    conflictResolution.push(
      `Subordinate bridge references reduced from ${originalScore} to ${bridge.score}; programme identity is hospital-led.`
    );
  }
  if (bridge && bridgeProgrammeIdentity) {
    const linkedBridgeRatio =
      corpus.relationshipSummary.bridgeActivityCount > 0
        ? corpus.relationshipSummary.linkedBridgeActivityCount /
          corpus.relationshipSummary.bridgeActivityCount
        : 0;
    bridge.score += 20 + (linkedBridgeRatio >= 0.5 ? 6 : 0);
    conflictResolution.push(
      linkedBridgeRatio >= 0.5
        ? "Bridge programme identity and connected bridge activity structure reached consensus."
        : "Bridge programme identity confirmed by project metadata, filename, or root WBS."
    );
  }
  ranked.sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const second = ranked[1];

  if (!top) {
    return emptyField(
      "No project type keywords found with sufficient confidence.",
      sources,
      "No sector keywords matched across programme text."
    );
  }

  const { confidence, reasoning, conflict } = calibrateKeywordConfidence(ranked, {
    minScore: 12,
    strongScore: 28,
    requireMultiSourceForHigh: true,
  });

  const traceExtras = {
    matchedKeywords: ranked.slice(0, 3),
    rejectedMatches: ranked.slice(1, 6),
    ignoredMatches: ignored,
    conflictResolution: conflictResolution.join(" "),
    confidenceReasoning: [reasoning, ...conflictResolution].filter(Boolean).join(" "),
    evidenceSummary: [
      `Winner: ${top.label} (${top.score})`,
      second ? `Runner-up: ${second.label} (${second.score})` : "No runner-up",
      ...conflictResolution,
    ],
    rawSignals: { relationshipStructure: corpus.relationshipSummary },
  };

  if (confidence === "none") {
    return emptyField("Project type signals were too weak to suggest a value.", sources, reasoning);
  }

  if (confidence === "low" || conflict) {
    return field(
      null,
      "low",
      conflict
        ? `${top.label} scored highest (${top.score}) but competing sectors remain — needs confirmation.`
        : "Project type evidence insufficient for automatic assignment.",
      "Possible match — needs confirmation.",
      buildTrace(sources, traceExtras)
    );
  }

  return field(
    top.label,
    confidence,
    `Detected from ${top.hits} matching term${top.hits === 1 ? "" : "s"} across project metadata, WBS, and activities.`,
    "Detected from programme contents.",
    buildTrace(sources, { ...traceExtras, matchedKeywords: [top, ...(ranked.slice(1, 3))] })
  );
}

function detectStage(
  activities: ImportedActivityRow[],
  tables: ReturnType<typeof parseXerTables>,
  corpus: SearchCorpus
): DetectedField {
  const sources = allSourceResults(corpus);
  const taskTable = tables.get("TASK");
  const projectRow = tables.get("PROJECT")?.rows[0];
  const reportingDate = String(projectRow?.last_recalc_date ?? projectRow?.last_schedule_date ?? "").trim();

  let complete = 0;
  let active = 0;
  let notStarted = 0;
  let totalPct = 0;
  let pctCount = 0;
  let milestoneComplete = 0;
  let milestoneTotal = 0;

  const rows = taskTable?.rows ?? [];
  for (const r of rows) {
    const status = String(r.status_code ?? "").toUpperCase();
    const pct = parseFloat(String(r.phys_complete_pct ?? ""));
    const isMilestone = isP6MilestoneType(r.task_type);
    if (isMilestone) milestoneTotal += 1;

    if (Number.isFinite(pct)) {
      totalPct += pct;
      pctCount += 1;
    }
    if (status.includes("COMPLETE") || (Number.isFinite(pct) && pct >= 99)) {
      complete += 1;
      if (isMilestone) milestoneComplete += 1;
    } else if (status.includes("ACTIVE") || (Number.isFinite(pct) && pct > 0 && pct < 99)) {
      active += 1;
    } else {
      notStarted += 1;
    }
  }

  const total = Math.max(1, rows.length || activities.length);
  const avgPct = pctCount > 0 ? totalPct / pctCount : 0;
  const completeRatio = complete / total;
  const activeRatio = active / total;
  const notStartedRatio = notStarted / total;
  const contentScores = scoreStageContent(corpus);
  const isBaselineSchedule = notStartedRatio >= 0.9 && avgPct < 2;

  let value: string;
  let confidence: DetectionConfidence;
  let reason: string;
  let reasoning: string;
  let conflictResolution: string | undefined;

  const detailedDesignHits = contentScores.detailedDesign ?? 0;
  const constructionHits = contentScores.construction ?? 0;
  const planningHits = contentScores.planning ?? 0;
  const procurementHits = contentScores.procurement ?? 0;
  const commissioningHits = contentScores.commissioning ?? 0;
  const detailedDesignStrength = detailedDesignHits * 5;
  const detailedDesignIsDominant =
    detailedDesignHits >= 3 &&
    detailedDesignHits >= commissioningHits &&
    detailedDesignStrength >= constructionHits;

  if (detailedDesignIsDominant) {
    value = "Detailed Design";
    confidence = detailedDesignHits >= 8 ? "high" : "medium";
    reason = `${detailedDesignHits} detailed/technical design signals found across the programme.`;
    reasoning =
      "Explicit engineering-design evidence determines lifecycle stage; progress is retained only as supporting status.";
    if (completeRatio >= 0.7) {
      conflictResolution =
        "High recorded progress did not override dominant Detailed Design evidence or imply Commissioning.";
    }
  } else if (
    commissioningHits >= 3 &&
    commissioningHits >= constructionHits &&
    commissioningHits > planningHits
  ) {
    value = "Commissioning";
    confidence = commissioningHits >= 6 ? "high" : "medium";
    reason = `${commissioningHits} commissioning/handover signals dominate programme content.`;
    reasoning = "Commissioning was assigned from explicit lifecycle evidence, with progress used only as support.";
  } else if (constructionHits >= 6 && constructionHits >= planningHits && constructionHits >= procurementHits) {
    value = "Construction";
    confidence = constructionHits >= 12 ? "high" : "medium";
    reason = `${constructionHits} construction trade signals dominate WBS and activity content.`;
    reasoning = "Construction classification is based on dominant engineering work-package evidence.";
  } else if (procurementHits >= 3 && procurementHits > planningHits) {
    value = "Procurement";
    confidence = procurementHits >= 6 ? "medium" : "low";
    reason = `${procurementHits} procurement/tender signals found in programme content.`;
    reasoning = "Procurement work packages provide the strongest available lifecycle evidence.";
  } else if (planningHits >= 3) {
    value = "Planning";
    confidence = planningHits >= 6 ? "medium" : "low";
    reason = `${planningHits} planning/concept signals found in programme content.`;
    reasoning = "Planning classification is supported by explicit early-stage content.";
  } else if (completeRatio >= 0.85 || avgPct >= 95) {
    value = "Completed";
    confidence = completeRatio >= 0.9 ? "high" : "medium";
    reason = `${Math.round(completeRatio * 100)}% of activities complete; average progress ${Math.round(avgPct)}%.`;
    reasoning = "Progress supports a completed status, but was not used to infer an engineering phase.";
  } else if (activeRatio >= 0.25 || avgPct >= 15) {
    value = "Construction";
    confidence = "low";
    reason = `${Math.round(activeRatio * 100)}% of activities in progress; average progress ${Math.round(avgPct)}%.`;
    reasoning = "No dominant lifecycle content was found; active progress provides only a low-confidence status fallback.";
  } else if (notStartedRatio >= 0.7) {
    value = "Planning";
    confidence = notStartedRatio >= 0.85 ? "high" : "medium";
    reason = `${Math.round(notStartedRatio * 100)}% of activities not yet started.`;
    reasoning = "Programme predominantly unstarted — consistent with planning stage.";
  } else {
    value = "Procurement";
    confidence = "low";
    reason = "Mixed early-stage status with limited construction progress.";
    reasoning = "Some activity but insufficient progress for construction classification.";
  }

  const evidenceSummary = [
    `Activities: ${total} (${complete} complete, ${active} active, ${notStarted} not started)`,
    `Average physical % complete: ${Math.round(avgPct)}`,
    reportingDate ? `Reporting date: ${reportingDate}` : "No reporting date in PROJECT table",
    milestoneTotal > 0 ? `Milestones complete: ${milestoneComplete}/${milestoneTotal}` : "No milestones identified",
    `Content signals: detailedDesign=${detailedDesignHits}, construction=${constructionHits}, planning=${planningHits}, procurement=${procurementHits}, commissioning=${commissioningHits}`,
    `Phase strength: detailedDesign=${detailedDesignStrength}, construction=${constructionHits} (explicit lifecycle signals weighted above generic trade terms)`,
  ].filter(Boolean);

  return field(value, confidence, reason, "Detected from programme content and progress.", buildTrace(sources, {
    confidenceReasoning: reasoning,
    evidenceSummary,
    conflictResolution,
    rawSignals: { completeRatio, activeRatio, notStartedRatio, avgPct, reportingDate, contentScores, isBaselineSchedule },
  }));
}

function detectComplexity(signals: {
  activityCount: number;
  relationshipCount: number;
  wbsDepth: number;
  wbsCount: number;
  calendarCount: number;
  resourceCount: number;
  constraintCount: number;
  workstreamCount: number;
}): DetectedField & { complexityDetail: ComplexityDetail } {
  const relDensity = signals.activityCount > 0 ? signals.relationshipCount / signals.activityCount : 0;

  const signalMap: Record<string, number> = {
    activityCount: signals.activityCount,
    relationshipDensity: relDensity,
    wbsDepth: signals.wbsDepth,
    wbsCount: signals.wbsCount,
    calendarCount: signals.calendarCount,
    resourceCount: signals.resourceCount,
    constraintCount: signals.constraintCount,
    workstreamCount: signals.workstreamCount,
  };

  const factors: ComplexityDetail["factors"] = [];
  let totalScore = 0;
  let maxScore = 0;

  for (const factor of COMPLEXITY_FACTORS) {
    const value = signalMap[factor.key] ?? 0;
    const contribution = tierPoints(value, [...factor.breakpoints], factor.maxPoints);
    totalScore += contribution;
    maxScore += factor.maxPoints;
    factors.push({
      name: factor.label,
      value: factor.key === "relationshipDensity" ? Math.round(value * 100) / 100 : value,
      contribution: Math.round(contribution * 10) / 10,
      maxContribution: factor.maxPoints,
    });
  }

  let score = Math.min(100, Math.round((totalScore / maxScore) * 100));
  if (signals.activityCount < 25) {
    score = Math.min(score, Math.max(2, Math.round((signals.activityCount / 25) * 22)));
  }
  if (signals.activityCount >= 100) {
    if (relDensity >= 1.0) score = Math.min(100, score + 6);
    if (signals.wbsCount >= 50) score = Math.min(100, score + 5);
    if (signals.workstreamCount >= 10) score = Math.min(100, score + 4);
  }
  if (signals.activityCount >= 150 && relDensity >= 1.2) {
    score = Math.min(100, score + 8);
  }
  if (signals.wbsDepth >= 4 && signals.constraintCount >= 10) {
    score = Math.min(100, score + 4);
  }
  const band = COMPLEXITY_BANDS.find((b) => score <= b.maxScore) ?? COMPLEXITY_BANDS[COMPLEXITY_BANDS.length - 1]!;
  const confidence: DetectionConfidence =
    signals.activityCount >= 100 ? "high" : signals.activityCount >= 20 ? "medium" : "low";

  const sources: SourceSearchResult[] = [
    { kind: "activity_names", label: SOURCE_LABELS.activity_names, searched: true, itemCount: signals.activityCount },
    { kind: "wbs", label: SOURCE_LABELS.wbs, searched: true, itemCount: signals.wbsCount },
    { kind: "calendars", label: SOURCE_LABELS.calendars, searched: true, itemCount: signals.calendarCount },
    { kind: "resources", label: SOURCE_LABELS.resources, searched: true, itemCount: signals.resourceCount },
  ];

  const evidenceSummary = [
    `${signals.activityCount} activities`,
    `${signals.wbsCount} WBS nodes (depth ${signals.wbsDepth})`,
    `${signals.relationshipCount} relationships`,
    `${signals.calendarCount} calendars`,
    relDensity >= 1.2 ? "High logic density" : relDensity >= 0.5 ? "Moderate logic density" : "Low logic density",
    signals.workstreamCount > 1 ? `${signals.workstreamCount} workstreams` : "Single workstream",
  ];

  const complexityDetail: ComplexityDetail = { score, maxScore: 100, band: band.label, factors };

  return {
    ...field(
      band.label,
      confidence,
      `Complexity band: ${band.label} — based on programme size and structure.`,
      "Detected from programme size and structure.",
      buildTrace(sources, {
        confidenceReasoning: `Weighted scoring model produced ${score}/100 — band "${band.label}".`,
        evidenceSummary,
        rawSignals: { ...signals, relationshipDensity: relDensity, score },
      })
    ),
    complexityDetail,
  };
}

function assessReadiness(detection: Omit<ProjectDetectionResult, "readiness" | "detectionTimeMs">): ProjectDetectionReadiness {
  const missing: string[] = [];
  if (!detection.projectName.value || detection.projectName.needsConfirmation) missing.push("Project name");
  if (!detection.clientType.value) missing.push("Client");
  if (!detection.projectType.value) missing.push("Project type");
  if (!detection.stage.value) missing.push("Stage");
  if (!detection.complexity.value) missing.push("Complexity");

  const criticalMissing = !detection.projectName.value;
  const ready = !criticalMissing && detection.projectName.confidence !== "none";

  return {
    ready,
    summary: ready
      ? missing.length === 0
        ? "Programme analysed successfully."
        : "Programme ready for onboarding — review the fields below."
      : "Please confirm the project name before continuing.",
    missingFields: missing,
  };
}

export function detectProjectFromXer(input: XerDetectionInput): ProjectDetectionResult {
  const started = performance.now();
  const text = input.buffer.toString("utf8");
  const tables = parseXerTables(text);
  const parsed = parseXerProgramme(input.buffer);

  const activities = parsed.activities;
  const activityCount = input.activityCount ?? activities.length;
  const relationshipCount = input.relationshipCount ?? parsed.relationships.length;
  const wbsCount = input.wbsCount ?? tables.get("PROJWBS")?.rows.length ?? 0;
  const calendarCount = input.calendarCount ?? tables.get("CALENDAR")?.rows.length ?? 0;
  const resourceCount = input.resourceCount ?? tables.get("RSRC")?.rows.length ?? 0;

  const wbsNodes = buildWbsNodes(tables);
  const rootId = findRootId(wbsNodes);
  const wbsDepth = rootId ? maxWbsDepth(wbsNodes, rootId) : 0;
  const workstreamCount = rootId ? countWorkstreams(wbsNodes, rootId) : 0;

  const taskTable = tables.get("TASK");
  let constraintCount = 0;
  if (taskTable) {
    for (const r of taskTable.rows) {
      const cstr = String(r.cstr_type ?? r.cstr_type2 ?? "").trim();
      if (cstr && cstr !== "0" && cstr.toLowerCase() !== "none") constraintCount += 1;
    }
  }

  const corpus = buildSearchCorpus(tables, activities, input.fileName);
  const projectName = detectProjectName(corpus, tables, input.fileName);
  const clientType = detectClient(corpus, projectName.value ?? "");
  const projectType = detectProjectType(corpus);
  const stage = detectStage(activities, tables, corpus);
  const complexity = detectComplexity({
    activityCount,
    relationshipCount,
    wbsDepth,
    wbsCount,
    calendarCount,
    resourceCount,
    constraintCount,
    workstreamCount,
  });

  const partial = { projectName, clientType, projectType, stage, complexity };
  const detectionTimeMs = Math.round(performance.now() - started);
  return { ...partial, readiness: assessReadiness(partial), detectionTimeMs };
}
