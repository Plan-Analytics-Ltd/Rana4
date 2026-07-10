import { parseXerTables } from "./xerParse.service.js";
import { isGenericProgrammeLabel, meaningfulFilenameTitle } from "../../import/projectDetection.naming.js";
import { prisma } from "../../../utils/prisma.js";
import { buildPlannerRevisionStoryLabel } from "./plannerLanguage.service.js";

type XerTables = ReturnType<typeof parseXerTables>;

export type ProgrammeNameSources = {
  ranaProjectName?: string | null;
  rootWbsName?: string | null;
  projName?: string | null;
  projShortName?: string | null;
  sourceFileName?: string | null;
};

/** Root PROJWBS title where proj_node_flag = Y. */
export function getRootWbsTitleFromTables(tables: XerTables): string | null {
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

export function extractProgrammeNameSourcesFromTables(
  tables: XerTables,
  sourceFileName?: string | null
): ProgrammeNameSources {
  const projectRow = tables.get("PROJECT")?.rows[0];
  return {
    rootWbsName: getRootWbsTitleFromTables(tables),
    projName: String(projectRow?.proj_name ?? "").trim() || null,
    projShortName: String(projectRow?.proj_short_name ?? "").trim() || null,
    sourceFileName: sourceFileName ?? null,
  };
}

/**
 * Canonical planner-facing programme name.
 * Priority: Rana project name → root WBS → proj_name → proj_short_name → filename.
 */
export function resolveCanonicalProgrammeName(sources: ProgrammeNameSources): string | null {
  const candidates: Array<string | null | undefined> = [
    sources.ranaProjectName,
    sources.rootWbsName,
    sources.projName && !isGenericProgrammeLabel(sources.projName) ? sources.projName : null,
    sources.projShortName && !isGenericProgrammeLabel(sources.projShortName)
      ? sources.projShortName
      : null,
    sources.sourceFileName ? meaningfulFilenameTitle(sources.sourceFileName) : null,
    sources.sourceFileName?.replace(/\.xer$/i, "").trim() || null,
  ];

  for (const c of candidates) {
    const name = String(c ?? "").trim();
    if (name && !isGenericProgrammeLabel(name)) return name.slice(0, 255);
  }
  return null;
}

export function extractProgrammeNameFromXerBuffer(
  buffer: Buffer,
  sourceFileName?: string | null,
  ranaProjectName?: string | null
): string | null {
  const text = buffer.toString("utf8");
  const tables = parseXerTables(text);
  const sources = extractProgrammeNameSourcesFromTables(tables, sourceFileName);
  sources.ranaProjectName = ranaProjectName ?? null;
  return resolveCanonicalProgrammeName(sources);
}

export { buildPlannerRevisionStoryLabel, computeLiveUpdateIndices } from "./plannerLanguage.service.js";

/** Planner-facing revision label: canonical programme name + story revision name. */
export function buildRevisionDisplayLabel(args: {
  programmeDisplayName: string | null;
  snapshotVersion: number;
  snapshotRole: string | null;
  programmeState?: string | null;
  liveUpdateIndex?: number | null;
  isLatestLiveUpdate?: boolean;
  totalLiveUpdates?: number;
  fallbackLabel?: string | null;
}): string {
  const story = buildPlannerRevisionStoryLabel({
    snapshotRole: args.snapshotRole,
    programmeState: args.programmeState ?? null,
    liveUpdateIndex: args.liveUpdateIndex ?? null,
    isLatestLiveUpdate: args.isLatestLiveUpdate ?? false,
    totalLiveUpdates: args.totalLiveUpdates ?? 0,
  });
  const base = args.programmeDisplayName?.trim() || args.fallbackLabel?.trim();
  if (base) return `${base} · ${story}`;
  return story;
}

export async function resolveProjectProgrammeDisplayName(
  projectId: string,
  companyId: string
): Promise<string> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId },
    select: { name: true },
  });

  const latest = await prisma.programmeSnapshot.findFirst({
    where: { projectId, companyId },
    orderBy: { importedAt: "desc" },
    select: { importSummary: true, label: true, sourceFileName: true },
  });

  const summary = latest?.importSummary as Record<string, unknown> | undefined;
  const stored = String(summary?.programmeDisplayName ?? "").trim();
  if (stored) return stored;

  const fromProject = resolveCanonicalProgrammeName({
    ranaProjectName: project?.name,
    sourceFileName: latest?.sourceFileName,
  });
  if (fromProject) return fromProject;

  return latest?.label?.trim() || project?.name || "Programme";
}
