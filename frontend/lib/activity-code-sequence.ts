/** Client helpers — mirrors backend activityCodeSequence.service.ts */

export type ParsedActivityCode = { prefix: string; number: number };

const CODE_RE = /^([A-Za-z]+)(\d+)$/;

export function parseActivityCode(code: string): ParsedActivityCode | null {
  const trimmed = code.trim();
  const m = CODE_RE.exec(trimmed);
  if (m) {
    const number = Number.parseInt(m[2]!, 10);
    if (!Number.isFinite(number) || number < 0) return null;
    return { prefix: m[1]!.toUpperCase(), number };
  }
  /** Legacy planner codes like ARC-A1001 — use trailing numeric suffix for ordering. */
  const legacy = /([A-Za-z]+)-(\d+)$/.exec(trimmed);
  if (legacy) {
    const number = Number.parseInt(legacy[2]!, 10);
    if (!Number.isFinite(number) || number < 0) return null;
    return { prefix: legacy[1]!.toUpperCase(), number };
  }
  return null;
}

export function formatActivityCode(prefix: string, number: number): string {
  return `${prefix.toUpperCase()}${number}`;
}

export function detectCodePrefix(codes: string[]): string {
  const counts = new Map<string, number>();
  for (const raw of codes) {
    const p = parseActivityCode(raw)?.prefix;
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best = "A";
  let max = 0;
  for (const [p, n] of counts) {
    if (n > max) {
      max = n;
      best = p;
    }
  }
  return best;
}

export function maxSequenceNumber(codes: string[], prefix: string): number {
  const p = prefix.toUpperCase();
  let max = 0;
  for (const code of codes) {
    const parsed = parseActivityCode(code);
    if (parsed?.prefix === p && parsed.number > max) max = parsed.number;
  }
  return max;
}

export function collectAllActivityCodes(
  fragnets: Array<{ deliverables: Array<{ activities: Array<{ activityCode: string }> }> }>
): string[] {
  const out: string[] = [];
  for (const f of fragnets) {
    for (const d of f.deliverables) {
      for (const a of d.activities) out.push(a.activityCode);
    }
  }
  return out;
}

export function compareActivityCodes(a: string, b: string): number {
  const pa = parseActivityCode(a);
  const pb = parseActivityCode(b);
  if (pa && pb) {
    if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
    return pa.number - pb.number;
  }
  return a.localeCompare(b);
}

/** Lowest numeric suffix on a deliverable's activities (for ordering deliverables). */
export function minActivityCodeNumber(activities: Array<{ activityCode: string }>): number {
  let min = Number.POSITIVE_INFINITY;
  for (const a of activities) {
    const p = parseActivityCode(a.activityCode);
    if (p && p.number < min) min = p.number;
  }
  return min;
}

/** Deliverables ordered by their first/lowest activity ID — not by name. */
export function sortDeliverablesByWorkflowOrder<T extends { activities: Array<{ activityCode: string }> }>(
  deliverables: T[]
): T[] {
  return [...deliverables]
    .map((d, index) => ({ d, index, min: minActivityCodeNumber(d.activities) }))
    .sort((a, b) => {
      if (a.min !== b.min) return a.min - b.min;
      return a.index - b.index;
    })
    .map((x) => x.d);
}

export function sortActivitiesByCode<T extends { activityCode: string }>(activities: T[]): T[] {
  return [...activities].sort((a, b) => compareActivityCodes(a.activityCode, b.activityCode));
}
