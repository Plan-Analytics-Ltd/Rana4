/** Planner-facing display helpers — mirrors backend naming rules. */

export function isGenericProgrammeLabel(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (/^programme[_\s.-]?v?\d/i.test(n)) return true;
  if (/\.(xml|xer|mpp|pp)(-\d+)?$/i.test(n)) return true;
  if (/^v\d+$/i.test(n)) return true;
  return false;
}

export function formatFragnetLabel(fragnetName: string, standardName?: string | null): string {
  const std = standardName?.trim();
  if (std && !isGenericProgrammeLabel(std)) {
    return `${fragnetName} (${std})`;
  }
  return fragnetName;
}

export function snapshotStoryFallbackLabel(args: {
  snapshotRole?: string | null;
  snapshotVersion?: number;
  label?: string | null;
  programmeDisplayName?: string | null;
}): string {
  const stored = args.programmeDisplayName?.trim() || args.label?.trim();
  if (stored && !isGenericProgrammeLabel(stored)) return stored;
  if (args.snapshotRole === "BASELINE") return "Baseline";
  if (args.snapshotRole === "AS_BUILT") return "As-built";
  if (args.snapshotVersion != null && args.snapshotVersion > 1) {
    return `Update ${args.snapshotVersion - 1}`;
  }
  return "Baseline";
}
