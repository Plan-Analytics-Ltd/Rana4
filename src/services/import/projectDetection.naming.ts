/**
 * Deterministic rules for recognising generic Primavera programme labels
 * and cleaning export filenames into human-readable project titles.
 *
 * Used by the project name fallback hierarchy only — not sector classification.
 */

/** Exact or pattern-matched labels that are never used as the project name. */
const GENERIC_EXACT = new Set(
  [
    "test",
    "baseline",
    "copy",
    "schedule",
    "untitled",
    "project",
    "programme",
    "program",
    "new project",
    "default",
    "temp",
    "temporary",
    "draft",
  ].map((s) => s.toLowerCase())
);

const GENERIC_PATTERNS: RegExp[] = [
  /\.(xml|xer|mpp|pp)$/i,
  /^programme[_\s.-]?v?\d/i,
  /^project[_\s.-]?\d*$/i,
  /^v\d+$/i,
  /^\d+$/,
  /\(copy\)/i,
  /\bcopy\s*\d*$/i,
  /[_\s-]copy$/i,
  /[_\s-]final$/i,
  /[_\s-]v\d+$/i,
  /[_\s-]\d{6,}$/, // trailing timestamps
  /^schedule[_\s-]?\d*/i,
  /^baseline[_\s-]?\d*/i,
];

const FILENAME_NOISE_PARTS =
  /^(baseline|as[- ]?built|update|revision|rev\s*\d+|copy|final|draft|v\d+|programme)$/i;

export function isGenericProgrammeLabel(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (GENERIC_EXACT.has(n.toLowerCase())) return true;
  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.test(n)) return true;
  }
  if (n.length <= 10 && !/\s/.test(n) && /[_\d]/.test(n)) return true;
  return false;
}

function cleanFilenamePart(part: string): string {
  return part
    .replace(/\(copy\)/gi, "")
    .replace(/\s*-\s*copy\s*$/i, "")
    .replace(/\s*_final\s*$/i, "")
    .replace(/\s*_v\d+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compose a human-readable title from an export filename when Primavera metadata is generic.
 */
export function meaningfulFilenameTitle(fileName: string): string | null {
  let stem = fileName.replace(/\.xer$/i, "").trim();
  stem = stem.replace(/^[A-Z0-9]+-\s*/i, "");
  stem = cleanFilenamePart(stem);

  const parts = stem
    .split(/\s*-\s*/)
    .map((s) => cleanFilenamePart(s))
    .filter(Boolean)
    .filter((p) => !FILENAME_NOISE_PARTS.test(p))
    .filter((p) => !/\bprogramme\b/i.test(p) || /\bbuilding\b/i.test(p));

  if (parts.length === 0) return stem.length >= 12 ? stem.slice(0, 255) : null;

  const place = parts.find((p) => /^[A-Za-z][A-Za-z'-]+$/.test(p));
  const descriptive = parts.find(
    (p) => p.split(/\s+/).length >= 2 && !p.toLowerCase().includes(place?.toLowerCase() ?? "___")
  );
  if (place && descriptive) {
    return `${place} ${descriptive}`.slice(0, 255);
  }
  const joined = parts.slice(0, 2).join(" - ");
  return joined.length >= 8 ? joined.slice(0, 255) : stem.length >= 12 ? stem.slice(0, 255) : null;
}
