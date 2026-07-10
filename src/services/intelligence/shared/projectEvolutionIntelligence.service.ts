import type { DeliverableEvolutionTrend } from "../matching/deliverableEvolution.service.js";

export type EvolutionRevisionInput = {
  label: string;
  role: string | null;
  importedAt: string | Date;
  durationDays: number | null;
  durationChangeDays: number | null;
};

export type DurationChangeStep = {
  revisionIndex: number;
  revisionLabel: string;
  changeDays: number;
  fromDays: number;
  toDays: number;
};

export type StablePeriod = {
  startRevisionIndex: number;
  endRevisionIndex: number;
  startLabel: string;
  endLabel: string;
  durationDays: number;
  revisionCount: number;
};

export type RevisionHighlight = {
  revisionIndex: number;
  revisionLabel: string;
  role: string | null;
  durationDays: number;
  durationChangeDays: number | null;
  highlightReason: string;
};

export type MajorEvolutionEventType =
  | "FIRST_DURATION_CHANGE"
  | "FINAL_DURATION_CHANGE"
  | "LARGEST_INCREASE"
  | "LARGEST_REDUCTION"
  | "LONGEST_STABLE_PERIOD"
  | "PEAK_DURATION"
  | "LOWEST_DURATION";

export type MajorEvolutionEvent = {
  type: MajorEvolutionEventType;
  revisionIndex: number;
  revisionLabel: string;
  description: string;
};

export type EvolutionVolatility = "LOW" | "MODERATE" | "HIGH";

export type EvolutionChangePattern =
  | "STABLE"
  | "GRADUAL"
  | "SUDDEN"
  | "OSCILLATING"
  | "MIXED";

export type EvolutionChangePace =
  | "MOSTLY_INCREASED"
  | "MOSTLY_DECREASED"
  | "MOSTLY_STABLE"
  | "MIXED";

export type ProjectEvolutionIntelligence = {
  summary: string;
  revisionCount: number;
  baseline: number | null;
  latest: number | null;
  peak: number | null;
  minimum: number | null;
  netChange: number | null;
  trend: DeliverableEvolutionTrend;
  volatility: EvolutionVolatility | null;
  changePattern: EvolutionChangePattern | null;
  changePace: EvolutionChangePace | null;
  largestIncrease: DurationChangeStep | null;
  largestReduction: DurationChangeStep | null;
  largestSingleRevisionChange: DurationChangeStep | null;
  firstMeaningfulChange: DurationChangeStep | null;
  latestMeaningfulChange: DurationChangeStep | null;
  stablePeriods: StablePeriod[];
  longestStablePeriod: StablePeriod | null;
  revisionHighlights: RevisionHighlight[];
  majorEvents: MajorEvolutionEvent[];
  timelineHighlights: string[];
  plannerObservations: string[];
  howChangedSummary: string | null;
};

type ResolvedRevision = {
  index: number;
  label: string;
  role: string | null;
  durationDays: number;
  changeDays: number | null;
};

function revisionLabel(rev: EvolutionRevisionInput, index: number): string {
  return rev.label?.trim() || `Revision ${index + 1}`;
}

function resolveRevisions(revisions: EvolutionRevisionInput[]): ResolvedRevision[] {
  const resolved: ResolvedRevision[] = [];
  for (let i = 0; i < revisions.length; i++) {
    const rev = revisions[i]!;
    if (rev.durationDays == null || !Number.isFinite(rev.durationDays)) continue;
    const durationDays = Math.round(rev.durationDays);
    const prev = resolved[resolved.length - 1];
    const changeDays =
      rev.durationChangeDays != null && Number.isFinite(rev.durationChangeDays)
        ? Math.round(rev.durationChangeDays)
        : prev != null
          ? durationDays - prev.durationDays
          : null;
    resolved.push({
      index: i,
      label: revisionLabel(rev, i),
      role: rev.role,
      durationDays,
      changeDays: i === 0 ? null : changeDays,
    });
  }
  return resolved;
}

function detectTrendFromDurations(durations: number[]): DeliverableEvolutionTrend {
  if (durations.length < 2) return "UNKNOWN";
  const first = durations[0]!;
  const last = durations[durations.length - 1]!;
  const changes = durations.slice(1).map((d, i) => d - durations[i]!);
  const signChanges = changes.filter((c, i) => i > 0 && Math.sign(c) !== Math.sign(changes[i - 1]!) && c !== 0 && changes[i - 1]! !== 0).length;
  if (signChanges >= 2) return "OSCILLATING";
  if (last > first * 1.1) return "GROWING";
  if (last < first * 0.9) return "SHRINKING";
  return "STABLE";
}

function computeVolatility(changes: number[]): EvolutionVolatility | null {
  const meaningful = changes.filter((c) => c !== 0);
  if (meaningful.length === 0) return "LOW";
  const magnitudes = meaningful.map((c) => Math.abs(c));
  const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
  if (mean === 0) return "LOW";
  const variance =
    magnitudes.reduce((sum, m) => sum + (m - mean) ** 2, 0) / magnitudes.length;
  const stdDev = Math.sqrt(variance);
  const ratio = stdDev / mean;
  if (ratio < 0.35) return "LOW";
  if (ratio < 0.85) return "MODERATE";
  return "HIGH";
}

function computeChangePattern(args: {
  netChange: number;
  baseline: number;
  changes: number[];
  largestAbsChange: number;
}): EvolutionChangePattern {
  const { netChange, baseline, changes, largestAbsChange } = args;
  const meaningful = changes.filter((c) => c !== 0);
  if (meaningful.length === 0) return "STABLE";

  const signChanges = meaningful.filter(
    (c, i) => i > 0 && Math.sign(c) !== Math.sign(meaningful[i - 1]!)
  ).length;
  if (signChanges >= 2) return "OSCILLATING";

  const totalAbsChange = meaningful.reduce((sum, c) => sum + Math.abs(c), 0);
  if (totalAbsChange > 0 && largestAbsChange / totalAbsChange >= 0.6) return "SUDDEN";

  if (Math.abs(netChange) <= Math.max(1, baseline * 0.05)) return "STABLE";

  if (meaningful.length >= 2) {
    const sameSign = meaningful.every((c) => Math.sign(c) === Math.sign(meaningful[0]!));
    if (sameSign) return "GRADUAL";
  }

  return "MIXED";
}

function computeChangePace(changes: number[]): EvolutionChangePace {
  const increases = changes.filter((c) => c > 0).length;
  const decreases = changes.filter((c) => c < 0).length;
  const stable = changes.filter((c) => c === 0).length;
  const max = Math.max(increases, decreases, stable);
  if (max === stable && stable > increases && stable > decreases) return "MOSTLY_STABLE";
  if (max === increases && increases > decreases) return "MOSTLY_INCREASED";
  if (max === decreases && decreases > increases) return "MOSTLY_DECREASED";
  return "MIXED";
}

function findStablePeriods(resolved: ResolvedRevision[]): StablePeriod[] {
  if (resolved.length === 0) return [];
  const periods: StablePeriod[] = [];
  let start = 0;
  for (let i = 1; i <= resolved.length; i++) {
    const prev = resolved[i - 1];
    const curr = resolved[i];
    const sameDuration = curr != null && curr.durationDays === prev!.durationDays;
    if (!sameDuration || i === resolved.length) {
      const end = sameDuration && i === resolved.length ? i - 1 : i - 1;
      const runLength = end - start + 1;
      if (runLength >= 2) {
        periods.push({
          startRevisionIndex: resolved[start]!.index,
          endRevisionIndex: resolved[end]!.index,
          startLabel: resolved[start]!.label,
          endLabel: resolved[end]!.label,
          durationDays: resolved[start]!.durationDays,
          revisionCount: runLength,
        });
      }
      start = i;
    }
  }
  return periods;
}

function buildChangeStep(
  resolved: ResolvedRevision[],
  targetIndex: number
): DurationChangeStep | null {
  const rev = resolved[targetIndex];
  const prev = resolved[targetIndex - 1];
  if (!rev || !prev || rev.changeDays == null || rev.changeDays === 0) return null;
  return {
    revisionIndex: rev.index,
    revisionLabel: rev.label,
    changeDays: rev.changeDays,
    fromDays: prev.durationDays,
    toDays: rev.durationDays,
  };
}

function formatDirection(changeDays: number): string {
  if (changeDays > 0) return "increased";
  if (changeDays < 0) return "reduced";
  return "stayed the same";
}

function buildHowChangedSummary(args: {
  changePattern: EvolutionChangePattern | null;
  firstMeaningfulChange: DurationChangeStep | null;
  latestMeaningfulChange: DurationChangeStep | null;
  largestSingleRevisionChange: DurationChangeStep | null;
  longestStablePeriod: StablePeriod | null;
  baseline: number | null;
  latest: number | null;
  netChange: number | null;
}): string | null {
  const parts: string[] = [];
  const { changePattern, firstMeaningfulChange, latestMeaningfulChange, largestSingleRevisionChange, longestStablePeriod, baseline, latest, netChange } = args;

  if (changePattern === "STABLE" && baseline != null) {
    parts.push(`Duration remained at ${baseline} days across the imported revisions.`);
  } else if (changePattern === "GRADUAL" && baseline != null && latest != null && netChange != null) {
    parts.push(
      `Duration ${formatDirection(netChange)} gradually from ${baseline} to ${latest} days across several revisions.`
    );
  } else if (changePattern === "SUDDEN" && largestSingleRevisionChange) {
    parts.push(
      `Most change happened in one step at ${largestSingleRevisionChange.revisionLabel}, where duration ${formatDirection(largestSingleRevisionChange.changeDays)} from ${largestSingleRevisionChange.fromDays} to ${largestSingleRevisionChange.toDays} days.`
    );
  } else if (changePattern === "OSCILLATING" && baseline != null && latest != null) {
    parts.push(`Duration moved up and down between revisions, ending at ${latest} days from a ${baseline}-day baseline.`);
  }

  if (longestStablePeriod && longestStablePeriod.revisionCount >= 2 && changePattern !== "STABLE") {
    parts.push(
      `Duration stayed at ${longestStablePeriod.durationDays} days from ${longestStablePeriod.startLabel} through ${longestStablePeriod.endLabel}.`
    );
  }

  if (firstMeaningfulChange && latestMeaningfulChange) {
    if (firstMeaningfulChange.revisionLabel !== latestMeaningfulChange.revisionLabel) {
      parts.push(
        `First change at ${firstMeaningfulChange.revisionLabel}; latest change at ${latestMeaningfulChange.revisionLabel}.`
      );
    }
  } else if (firstMeaningfulChange) {
    parts.push(`First duration change appeared at ${firstMeaningfulChange.revisionLabel}.`);
  }

  if (parts.length === 0 && baseline != null && latest != null && netChange != null && netChange !== 0) {
    parts.push(`Duration moved from ${baseline} to ${latest} days across the revision history.`);
  }

  if (parts.length === 0) return null;

  return `${parts.join(" ")} The imported programme history does not record why those planning decisions were made.`;
}

function buildPlannerObservations(args: {
  resolved: ResolvedRevision[];
  changePattern: EvolutionChangePattern | null;
  changePace: EvolutionChangePace | null;
  longestStablePeriod: StablePeriod | null;
  firstMeaningfulChange: DurationChangeStep | null;
  latestMeaningfulChange: DurationChangeStep | null;
  largestSingleRevisionChange: DurationChangeStep | null;
  netChange: number | null;
  baseline: number | null;
}): string[] {
  const observations: string[] = [];
  const {
    resolved,
    changePattern,
    changePace,
    longestStablePeriod,
    firstMeaningfulChange,
    latestMeaningfulChange,
    largestSingleRevisionChange,
    netChange,
    baseline,
  } = args;

  if (resolved.length <= 1) {
    observations.push("Only one programme revision is imported — more updates are needed to analyse evolution.");
    return observations;
  }

  if (changePattern === "STABLE" && baseline != null) {
    observations.push(`Duration stayed at ${baseline} days across all imported revisions.`);
    return observations;
  }

  if (changePattern === "GRADUAL" && netChange != null && netChange < 0) {
    observations.push("Duration reduced steadily throughout the project.");
  } else if (changePattern === "GRADUAL" && netChange != null && netChange > 0) {
    observations.push("Duration grew steadily throughout the project.");
  }

  if (changePattern === "SUDDEN" && largestSingleRevisionChange) {
    observations.push("Most duration change occurred in a single revision.");
  }

  if (longestStablePeriod && longestStablePeriod.startRevisionIndex === resolved[0]?.index) {
    observations.push(
      `This work package stayed unchanged for the first ${longestStablePeriod.revisionCount} revisions before later adjustments.`
    );
  }

  if (firstMeaningfulChange && latestMeaningfulChange) {
    const midpoint = Math.floor(resolved.length / 2);
    if (firstMeaningfulChange.revisionIndex < midpoint && latestMeaningfulChange.revisionIndex < midpoint) {
      observations.push("Most change happened early in the revision history.");
    } else if (firstMeaningfulChange.revisionIndex >= midpoint && latestMeaningfulChange.revisionIndex >= midpoint) {
      observations.push("Most change happened late in the revision history.");
    }
  }

  if (longestStablePeriod && longestStablePeriod.startRevisionIndex > 0) {
    observations.push(`Planning remained stable after ${longestStablePeriod.startLabel}.`);
  }

  const meaningfulChanges = resolved.filter((r) => r.changeDays != null && r.changeDays !== 0);
  if (meaningfulChanges.length >= 3 && changePattern !== "SUDDEN") {
    const allSmall = meaningfulChanges.every((r) => Math.abs(r.changeDays!) <= 2);
    if (allSmall) {
      observations.push("Several small adjustments were made instead of one major revision.");
    }
  }

  if (changePace === "MOSTLY_DECREASED" && meaningfulChanges.length >= 2) {
    const allNegative = meaningfulChanges.every((r) => (r.changeDays ?? 0) < 0);
    if (allNegative) observations.push("Revisions mostly reduced duration step by step.");
  }

  if (changePace === "MOSTLY_INCREASED" && meaningfulChanges.length >= 2) {
    const allPositive = meaningfulChanges.every((r) => (r.changeDays ?? 0) > 0);
    if (allPositive) observations.push("Revisions mostly increased duration step by step.");
  }

  if (firstMeaningfulChange == null && baseline != null) {
    observations.push("No meaningful duration changes were made after baseline.");
  }

  return [...new Set(observations)];
}

function buildTimelineHighlights(args: {
  resolved: ResolvedRevision[];
  largestSingleRevisionChange: DurationChangeStep | null;
  firstMeaningfulChange: DurationChangeStep | null;
  latestMeaningfulChange: DurationChangeStep | null;
  peak: number | null;
  minimum: number | null;
}): string[] {
  const highlights: string[] = [];
  const { resolved, largestSingleRevisionChange, firstMeaningfulChange, latestMeaningfulChange, peak, minimum } = args;

  if (resolved.length > 0) {
    highlights.push(`${resolved[0]!.label}: ${resolved[0]!.durationDays} days (baseline).`);
  }
  if (firstMeaningfulChange) {
    highlights.push(
      `${firstMeaningfulChange.revisionLabel}: ${formatDirection(firstMeaningfulChange.changeDays)} to ${firstMeaningfulChange.toDays} days.`
    );
  }
  if (largestSingleRevisionChange) {
    highlights.push(
      `${largestSingleRevisionChange.revisionLabel}: largest step (${largestSingleRevisionChange.changeDays > 0 ? "+" : ""}${largestSingleRevisionChange.changeDays} days).`
    );
  }
  if (peak != null && minimum != null && peak !== minimum) {
    const peakRev = resolved.find((r) => r.durationDays === peak);
    const minRev = resolved.find((r) => r.durationDays === minimum);
    if (peakRev) highlights.push(`${peakRev.label}: peak at ${peak} days.`);
    if (minRev && minRev.label !== peakRev?.label) highlights.push(`${minRev.label}: lowest at ${minimum} days.`);
  }
  if (latestMeaningfulChange && resolved.length > 0) {
    const last = resolved[resolved.length - 1]!;
    if (last.label !== latestMeaningfulChange.revisionLabel || last.changeDays != null) {
      highlights.push(`${last.label}: latest at ${last.durationDays} days.`);
    }
  } else if (resolved.length > 0) {
    const last = resolved[resolved.length - 1]!;
    highlights.push(`${last.label}: latest at ${last.durationDays} days.`);
  }

  return [...new Set(highlights)];
}

function buildRevisionHighlights(args: {
  resolved: ResolvedRevision[];
  largestIncrease: DurationChangeStep | null;
  largestReduction: DurationChangeStep | null;
  largestSingleRevisionChange: DurationChangeStep | null;
  firstMeaningfulChange: DurationChangeStep | null;
  latestMeaningfulChange: DurationChangeStep | null;
}): RevisionHighlight[] {
  const highlights: RevisionHighlight[] = [];
  const add = (step: DurationChangeStep | null, reason: string) => {
    if (!step) return;
    const rev = args.resolved.find((r) => r.index === step.revisionIndex);
    if (!rev) return;
    if (highlights.some((h) => h.revisionIndex === rev.index && h.highlightReason === reason)) return;
    highlights.push({
      revisionIndex: rev.index,
      revisionLabel: rev.label,
      role: rev.role,
      durationDays: rev.durationDays,
      durationChangeDays: rev.changeDays,
      highlightReason: reason,
    });
  };

  add(args.largestSingleRevisionChange, "Largest single revision change");
  add(args.largestIncrease, "Largest increase");
  add(args.largestReduction, "Largest reduction");
  add(args.firstMeaningfulChange, "First meaningful change");
  add(args.latestMeaningfulChange, "Latest meaningful change");

  return highlights.sort((a, b) => a.revisionIndex - b.revisionIndex);
}

function buildMajorEvents(args: {
  resolved: ResolvedRevision[];
  largestIncrease: DurationChangeStep | null;
  largestReduction: DurationChangeStep | null;
  firstMeaningfulChange: DurationChangeStep | null;
  latestMeaningfulChange: DurationChangeStep | null;
  longestStablePeriod: StablePeriod | null;
  peak: number | null;
  minimum: number | null;
}): MajorEvolutionEvent[] {
  const events: MajorEvolutionEvent[] = [];
  const { resolved, largestIncrease, largestReduction, firstMeaningfulChange, latestMeaningfulChange, longestStablePeriod, peak, minimum } = args;

  if (firstMeaningfulChange) {
    events.push({
      type: "FIRST_DURATION_CHANGE",
      revisionIndex: firstMeaningfulChange.revisionIndex,
      revisionLabel: firstMeaningfulChange.revisionLabel,
      description: `First duration change: ${firstMeaningfulChange.fromDays} → ${firstMeaningfulChange.toDays} days.`,
    });
  }
  if (latestMeaningfulChange && latestMeaningfulChange.revisionLabel !== firstMeaningfulChange?.revisionLabel) {
    events.push({
      type: "FINAL_DURATION_CHANGE",
      revisionIndex: latestMeaningfulChange.revisionIndex,
      revisionLabel: latestMeaningfulChange.revisionLabel,
      description: `Latest duration change: ${latestMeaningfulChange.fromDays} → ${latestMeaningfulChange.toDays} days.`,
    });
  }
  if (largestIncrease) {
    events.push({
      type: "LARGEST_INCREASE",
      revisionIndex: largestIncrease.revisionIndex,
      revisionLabel: largestIncrease.revisionLabel,
      description: `Largest increase: +${largestIncrease.changeDays} days.`,
    });
  }
  if (largestReduction) {
    events.push({
      type: "LARGEST_REDUCTION",
      revisionIndex: largestReduction.revisionIndex,
      revisionLabel: largestReduction.revisionLabel,
      description: `Largest reduction: ${largestReduction.changeDays} days.`,
    });
  }
  if (longestStablePeriod) {
    events.push({
      type: "LONGEST_STABLE_PERIOD",
      revisionIndex: longestStablePeriod.startRevisionIndex,
      revisionLabel: longestStablePeriod.startLabel,
      description: `${longestStablePeriod.revisionCount} revisions at ${longestStablePeriod.durationDays} days (${longestStablePeriod.startLabel} – ${longestStablePeriod.endLabel}).`,
    });
  }
  const peakRev = peak != null ? resolved.find((r) => r.durationDays === peak) : undefined;
  if (peakRev) {
    events.push({
      type: "PEAK_DURATION",
      revisionIndex: peakRev.index,
      revisionLabel: peakRev.label,
      description: `Peak duration: ${peak} days.`,
    });
  }
  const minRev = minimum != null ? resolved.find((r) => r.durationDays === minimum) : undefined;
  if (minRev && minRev.label !== peakRev?.label) {
    events.push({
      type: "LOWEST_DURATION",
      revisionIndex: minRev.index,
      revisionLabel: minRev.label,
      description: `Lowest duration: ${minimum} days.`,
    });
  }

  return events;
}

function buildSummary(args: {
  baseline: number | null;
  latest: number | null;
  netChange: number | null;
  revisionCount: number;
  trend: DeliverableEvolutionTrend;
  changePattern: EvolutionChangePattern | null;
}): string {
  const { baseline, latest, netChange, revisionCount, trend, changePattern } = args;
  if (revisionCount <= 1) {
    return "Only one programme revision is imported so far.";
  }
  if (baseline == null || latest == null) {
    return `${revisionCount} programme revisions imported, but duration is not fully recorded.`;
  }
  if (netChange === 0 || changePattern === "STABLE") {
    return `Duration stayed at ${latest} days across ${revisionCount} programme revisions on this project.`;
  }
  const direction = netChange! > 0 ? "grew" : "reduced";
  const patternPhrase =
    changePattern === "SUDDEN"
      ? "mostly in one step"
      : changePattern === "GRADUAL"
        ? "gradually"
        : changePattern === "OSCILLATING"
          ? "with ups and downs"
          : "";
  const patternText = patternPhrase ? `, ${patternPhrase},` : "";
  return `Duration ${direction} from ${baseline} to ${latest} days${patternText} across ${revisionCount} programme revisions on this project.`;
}

/** Deterministic planner intelligence derived from imported revision evidence only. */
export function computeProjectEvolutionIntelligence(
  revisions: EvolutionRevisionInput[]
): ProjectEvolutionIntelligence {
  const resolved = resolveRevisions(revisions);
  const durations = resolved.map((r) => r.durationDays);
  const stepChanges = resolved.slice(1).map((r) => r.changeDays ?? 0);

  const baseline = durations[0] ?? null;
  const latest = durations[durations.length - 1] ?? null;
  const peak = durations.length ? Math.max(...durations) : null;
  const minimum = durations.length ? Math.min(...durations) : null;
  const netChange = baseline != null && latest != null ? latest - baseline : null;
  const trend = detectTrendFromDurations(durations);
  const volatility = stepChanges.length ? computeVolatility(stepChanges) : null;

  let largestIncrease: DurationChangeStep | null = null;
  let largestReduction: DurationChangeStep | null = null;
  let largestSingleRevisionChange: DurationChangeStep | null = null;
  let largestAbs = 0;

  for (let i = 1; i < resolved.length; i++) {
    const step = buildChangeStep(resolved, i);
    if (!step || step.changeDays === 0) continue;
    const abs = Math.abs(step.changeDays);
    if (abs > largestAbs) {
      largestAbs = abs;
      largestSingleRevisionChange = step;
    }
    if (step.changeDays > 0 && (!largestIncrease || step.changeDays > largestIncrease.changeDays)) {
      largestIncrease = step;
    }
    if (step.changeDays < 0 && (!largestReduction || step.changeDays < largestReduction.changeDays)) {
      largestReduction = step;
    }
  }

  let firstMeaningfulChange: DurationChangeStep | null = null;
  let latestMeaningfulChange: DurationChangeStep | null = null;
  for (let i = 1; i < resolved.length; i++) {
    const step = buildChangeStep(resolved, i);
    if (!step || step.changeDays === 0) continue;
    if (!firstMeaningfulChange) firstMeaningfulChange = step;
    latestMeaningfulChange = step;
  }

  const stablePeriods = findStablePeriods(resolved);
  const longestStablePeriod =
    stablePeriods.length > 0
      ? stablePeriods.reduce((a, b) => (b.revisionCount > a.revisionCount ? b : a))
      : null;

  const changePattern =
    baseline != null
      ? computeChangePattern({
          netChange: netChange ?? 0,
          baseline,
          changes: stepChanges,
          largestAbsChange: largestAbs,
        })
      : null;
  const changePace = stepChanges.length ? computeChangePace(stepChanges) : null;

  const revisionHighlights = buildRevisionHighlights({
    resolved,
    largestIncrease,
    largestReduction,
    largestSingleRevisionChange,
    firstMeaningfulChange,
    latestMeaningfulChange,
  });

  const majorEvents = buildMajorEvents({
    resolved,
    largestIncrease,
    largestReduction,
    firstMeaningfulChange,
    latestMeaningfulChange,
    longestStablePeriod,
    peak,
    minimum,
  });

  const timelineHighlights = buildTimelineHighlights({
    resolved,
    largestSingleRevisionChange,
    firstMeaningfulChange,
    latestMeaningfulChange,
    peak,
    minimum,
  });

  const plannerObservations = buildPlannerObservations({
    resolved,
    changePattern,
    changePace,
    longestStablePeriod,
    firstMeaningfulChange,
    latestMeaningfulChange,
    largestSingleRevisionChange,
    netChange,
    baseline,
  });

  const howChangedSummary = buildHowChangedSummary({
    changePattern,
    firstMeaningfulChange,
    latestMeaningfulChange,
    largestSingleRevisionChange,
    longestStablePeriod,
    baseline,
    latest,
    netChange,
  });

  const summary = buildSummary({
    baseline,
    latest,
    netChange,
    revisionCount: revisions.length,
    trend,
    changePattern,
  });

  return {
    summary,
    revisionCount: revisions.length,
    baseline,
    latest,
    peak,
    minimum,
    netChange,
    trend,
    volatility,
    changePattern,
    changePace,
    largestIncrease,
    largestReduction,
    largestSingleRevisionChange,
    firstMeaningfulChange,
    latestMeaningfulChange,
    stablePeriods,
    longestStablePeriod,
    revisionHighlights,
    majorEvents,
    timelineHighlights,
    plannerObservations,
    howChangedSummary,
  };
}
