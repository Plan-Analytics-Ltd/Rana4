/**
 * Duration Statistics — deterministic min/avg/max over already-matched deliverables.
 *
 * This service knows nothing about matching. It receives the matched
 * deliverables produced by the existing similarity engine and summarises
 * their durations. No AI, no weighting, no recommendations.
 */

export type MatchedDurationInput = {
  projectId: string;
  projectName: string;
  deliverableName: string;
  durationDays: number;
};

export type DurationStatisticsEntry = {
  projectName: string;
  deliverableName: string;
  durationDays: number;
};

export type DurationStatistics = {
  available: boolean;
  projectsUsed: number;
  sampleCount: number;
  minimumDays: number | null;
  averageDays: number | null;
  maximumDays: number | null;
  entries: DurationStatisticsEntry[];
};

const EMPTY_STATISTICS: DurationStatistics = {
  available: false,
  projectsUsed: 0,
  sampleCount: 0,
  minimumDays: null,
  averageDays: null,
  maximumDays: null,
  entries: [],
};

/**
 * Compute duration statistics from matched deliverables on previous completed
 * projects. Matches from the current project are excluded — those belong to
 * Project Evolution, not cross-project statistics.
 */
export function computeDurationStatistics(
  matched: MatchedDurationInput[],
  options?: { excludeProjectId?: string }
): DurationStatistics {
  const samples = matched.filter(
    (m) =>
      Number.isFinite(m.durationDays) &&
      m.durationDays > 0 &&
      (!options?.excludeProjectId || m.projectId !== options.excludeProjectId)
  );

  if (samples.length === 0) return EMPTY_STATISTICS;

  const durations = samples.map((s) => s.durationDays);
  const total = durations.reduce((sum, d) => sum + d, 0);
  const projectsUsed = new Set(samples.map((s) => s.projectId)).size;

  return {
    available: true,
    projectsUsed,
    sampleCount: samples.length,
    minimumDays: Math.min(...durations),
    averageDays: Math.round((total / durations.length) * 10) / 10,
    maximumDays: Math.max(...durations),
    entries: samples.map((s) => ({
      projectName: s.projectName,
      deliverableName: s.deliverableName,
      durationDays: s.durationDays,
    })),
  };
}
