import type { ProgrammeState } from "@prisma/client";

export type FragnetActivityLink = {
  deliverableId?: string | null;
  fragnetId?: string | null;
};

export type DeliverableSnapshotContextFields = {
  fragnetId: string | null;
  parentWbs: string | null;
  wbsPath: string | null;
  stage: string | null;
  discipline: string | null;
};

function trimmed(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return v.length > 0 ? v : null;
}

/**
 * Dominant fragnet for a deliverable within a snapshot.
 * Precedence: highest activity count, then lexicographically smallest fragnetId.
 * Falls back to live deliverable fragnetId when no linked activities carry fragnetId.
 */
export function resolveDominantFragnetId(
  deliverableId: string,
  activities: FragnetActivityLink[],
  liveDeliverableFragnetId?: string | null
): string | null {
  const counts = new Map<string, number>();
  for (const activity of activities) {
    if (activity.deliverableId !== deliverableId) continue;
    const fragnetId = trimmed(activity.fragnetId);
    if (!fragnetId) continue;
    counts.set(fragnetId, (counts.get(fragnetId) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return trimmed(liveDeliverableFragnetId);
  }

  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  return ranked[0]![0];
}

function disciplineFromClassificationTags(tags: Record<string, unknown> | null | undefined): string | null {
  if (!tags || typeof tags !== "object") return null;
  for (const [key, value] of Object.entries(tags)) {
    if (!key.toLowerCase().includes("discipline")) continue;
    const resolved = trimmed(value);
    if (resolved) return resolved.toLowerCase();
  }
  return null;
}

function dominantDisciplineFromActivities(
  activities: Array<{ classificationTags?: Record<string, unknown> | null }>
): string | null {
  const counts = new Map<string, number>();
  for (const activity of activities) {
    const discipline = disciplineFromClassificationTags(activity.classificationTags ?? null);
    if (!discipline) continue;
    counts.set(discipline, (counts.get(discipline) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  return ranked[0]![0];
}

/**
 * Resolve deliverable discipline from persisted or imported metadata only.
 * Precedence: snapshot discipline → deliverable classificationTags → programme disciplineTags → activity tags.
 */
export function resolveDeliverableDiscipline(args: {
  snapshotDiscipline?: string | null;
  classificationTags?: Record<string, unknown> | null;
  programmeDisciplineTags?: unknown;
  linkedActivities?: Array<{ classificationTags?: Record<string, unknown> | null }>;
}): string | null {
  const snapshotDiscipline = trimmed(args.snapshotDiscipline);
  if (snapshotDiscipline) return snapshotDiscipline.toLowerCase();

  const fromDeliverableTags = disciplineFromClassificationTags(args.classificationTags ?? null);
  if (fromDeliverableTags) return fromDeliverableTags;

  const programmeTags = Array.isArray(args.programmeDisciplineTags) ? args.programmeDisciplineTags : [];
  for (const tag of programmeTags) {
    const value = trimmed(typeof tag === "string" ? tag : null);
    if (value) return value.toLowerCase();
  }

  return dominantDisciplineFromActivities(args.linkedActivities ?? []);
}

/**
 * Historical stage resolution (deterministic, no invented stages).
 * Precedence:
 * 1. Deliverable snapshot stage (imported / persisted)
 * 2. Programme snapshot stage
 * 3. Project intelligence profile stage / primary RIBA stage
 * 4. Programme state mapping (no mapping defined — returns null)
 */
export function resolveSnapshotDeliverableStage(args: {
  deliverableStage?: string | null;
  programmeSnapshotStage?: string | null;
  projectProfileStage?: string | null;
  projectProfilePrimaryRibaStage?: string | null;
  programmeState?: ProgrammeState | null;
}): string | null {
  const deliverableStage = trimmed(args.deliverableStage);
  if (deliverableStage) return deliverableStage;

  const programmeStage = trimmed(args.programmeSnapshotStage);
  if (programmeStage) return programmeStage;

  const profileStage = trimmed(args.projectProfileStage);
  if (profileStage) return profileStage;

  const ribaStage = trimmed(args.projectProfilePrimaryRibaStage);
  if (ribaStage) return ribaStage;

  return stageFromProgrammeState(args.programmeState);
}

/** No synthetic stage labels — only explicit profile/import metadata is used. */
export function stageFromProgrammeState(_programmeState?: ProgrammeState | null): string | null {
  return null;
}

export type BuildSnapshotContextArgs = {
  deliverableId: string;
  deliverableStage?: string | null;
  classificationTags?: Record<string, unknown> | null;
  activities: Array<
    FragnetActivityLink & { classificationTags?: Record<string, unknown> | null }
  >;
  liveDeliverableFragnetId?: string | null;
  liveDeliverableFragnetName?: string | null;
  fragnetNamesById: Map<string, string>;
  programmeSnapshotStage?: string | null;
  programmeDisciplineTags?: unknown;
  projectProfileStage?: string | null;
  projectProfilePrimaryRibaStage?: string | null;
  programmeState?: ProgrammeState | null;
  snapshotDiscipline?: string | null;
};

/** Build self-describing WBS/stage/discipline fields for a deliverable snapshot at capture or repair. */
export function buildDeliverableSnapshotContext(args: BuildSnapshotContextArgs): DeliverableSnapshotContextFields {
  const linked = args.activities.filter((a) => a.deliverableId === args.deliverableId);
  const fragnetId =
    resolveDominantFragnetId(args.deliverableId, linked, args.liveDeliverableFragnetId) ??
    trimmed(args.liveDeliverableFragnetId);

  const parentWbs =
    (fragnetId ? trimmed(args.fragnetNamesById.get(fragnetId)) : null) ??
    trimmed(args.liveDeliverableFragnetName);

  const wbsPath = parentWbs;

  const stage = resolveSnapshotDeliverableStage({
    deliverableStage: args.deliverableStage,
    programmeSnapshotStage: args.programmeSnapshotStage,
    projectProfileStage: args.projectProfileStage,
    projectProfilePrimaryRibaStage: args.projectProfilePrimaryRibaStage,
    programmeState: args.programmeState,
  });

  const discipline = resolveDeliverableDiscipline({
    snapshotDiscipline: args.snapshotDiscipline,
    classificationTags: args.classificationTags,
    programmeDisciplineTags: args.programmeDisciplineTags,
    linkedActivities: linked,
  });

  return { fragnetId, parentWbs, wbsPath, stage, discipline };
}

export type ProgrammeSnapshotMetadataFields = {
  sector: string | null;
  projectType: string | null;
  procurementRoute: string | null;
  stage: string | null;
  region: string | null;
  clientType: string | null;
  complexity: string | null;
  disciplineTags: string[];
  projectTags: string[];
  classificationTagsList: string[];
};

/** Copy project intelligence profile metadata onto programme snapshot at capture time. */
export function buildProgrammeSnapshotMetadataFromProfile(profile: {
  sector?: string | null;
  projectType?: string | null;
  procurementRoute?: string | null;
  stage?: string | null;
  primaryRibaStage?: string | null;
  region?: string | null;
  clientType?: string | null;
  complexity?: string | null;
  disciplineTags?: unknown;
  projectTags?: unknown;
  classificationTagsList?: unknown;
} | null): ProgrammeSnapshotMetadataFields {
  const tags = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((t) => trimmed(t)).filter((t): t is string => Boolean(t)) : [];

  return {
    sector: trimmed(profile?.sector),
    projectType: trimmed(profile?.projectType),
    procurementRoute: trimmed(profile?.procurementRoute),
    stage: trimmed(profile?.stage) ?? trimmed(profile?.primaryRibaStage),
    region: trimmed(profile?.region),
    clientType: trimmed(profile?.clientType),
    complexity: trimmed(profile?.complexity),
    disciplineTags: tags(profile?.disciplineTags),
    projectTags: tags(profile?.projectTags),
    classificationTagsList: tags(profile?.classificationTagsList),
  };
}
