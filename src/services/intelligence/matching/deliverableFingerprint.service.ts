import type { ProgrammeState } from "@prisma/client";

export type DeliverableFingerprint = {
  normalizedName: string;
  discipline: string | null;
  classification: string | null;
  parentWbs: string | null;
  fragnetId: string | null;
  activityCount: number;
  criticalActivityCount: number;
  activityCodePattern: string[];
  durationProfile: {
    medianDays: number | null;
    minDays: number | null;
    maxDays: number | null;
  };
  typicalPredecessors: string[];
  typicalSuccessors: string[];
  stage: string | null;
  keywords: string[];
  programmeState: ProgrammeState | null;
};

export type ActivityCompositionInput = {
  activityCode: string;
  name?: string | null;
  originalDuration?: number | null;
  remainingDuration?: number | null;
  isCritical?: boolean;
  classificationTags?: Record<string, unknown> | null;
};

function norm(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function normalizeDeliverableName(name: string): string {
  return norm(name).replace(/\s+/g, " ").trim();
}

function tokenizeKeywords(name: string): string[] {
  return normalizeDeliverableName(name)
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function durationDays(values: number[]): { medianDays: number | null; minDays: number | null; maxDays: number | null } {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { medianDays: null, minDays: null, maxDays: null };
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  return { medianDays: median, minDays: sorted[0]!, maxDays: sorted[sorted.length - 1]! };
}

function activityCodePattern(codes: string[]): string[] {
  const prefixes = new Map<string, number>();
  for (const code of codes) {
    const prefix = code.replace(/\d+$/, "").trim().toUpperCase();
    if (prefix.length >= 2) prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
  }
  return [...prefixes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([p]) => p);
}

/** Build a canonical fingerprint from deliverable metadata and linked activities. */
export function buildDeliverableFingerprint(args: {
  deliverableName: string;
  classification?: string | null;
  discipline?: string | null;
  parentWbs?: string | null;
  fragnetId?: string | null;
  stage?: string | null;
  programmeState?: ProgrammeState | null;
  activities?: ActivityCompositionInput[];
  predecessorNames?: string[];
  successorNames?: string[];
  /** Planner-visible deliverable duration (days) — preferred over activity duration medians. */
  durationDaysOverride?: number | null;
}): DeliverableFingerprint {
  const activities = args.activities ?? [];
  const durations = activities
    .map((a) => a.originalDuration ?? a.remainingDuration ?? null)
    .filter((d): d is number => d != null && Number.isFinite(d));

  const durationProfile =
    args.durationDaysOverride != null && Number.isFinite(args.durationDaysOverride) && args.durationDaysOverride >= 0
      ? {
          medianDays: args.durationDaysOverride,
          minDays: args.durationDaysOverride,
          maxDays: args.durationDaysOverride,
        }
      : durationDays(durations);

  const keywords = new Set<string>([
    ...tokenizeKeywords(args.deliverableName),
    ...(args.discipline ? [norm(args.discipline)] : []),
    ...(args.classification ? [norm(args.classification)] : []),
  ]);

  return {
    normalizedName: normalizeDeliverableName(args.deliverableName),
    discipline: args.discipline ?? null,
    classification: args.classification ?? null,
    parentWbs: args.parentWbs ?? null,
    fragnetId: args.fragnetId ?? null,
    activityCount: activities.length,
    criticalActivityCount: activities.filter((a) => a.isCritical).length,
    activityCodePattern: activityCodePattern(activities.map((a) => a.activityCode)),
    durationProfile,
    typicalPredecessors: (args.predecessorNames ?? []).map(normalizeDeliverableName).filter(Boolean).slice(0, 5),
    typicalSuccessors: (args.successorNames ?? []).map(normalizeDeliverableName).filter(Boolean).slice(0, 5),
    stage: args.stage ?? null,
    keywords: [...keywords],
    programmeState: args.programmeState ?? null,
  };
}

export function fingerprintCacheKey(fp: DeliverableFingerprint): string {
  return [fp.normalizedName, fp.classification ?? "", fp.fragnetId ?? fp.parentWbs ?? ""].join("|");
}
