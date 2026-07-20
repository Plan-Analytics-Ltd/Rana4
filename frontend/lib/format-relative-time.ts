/** Relative time for recent dates; short absolute date for anything older than one week. */
export function formatRelativeTime(iso: string, opts?: { maxRelativeDays?: number }): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const maxRelativeDays = opts?.maxRelativeDays ?? 7;
  const diffMs = Date.now() - d.getTime();
  const diffDay = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDay >= maxRelativeDays) {
    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
    });
  }

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}
