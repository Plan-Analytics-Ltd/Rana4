import { prisma } from "../utils/prisma.js";

export type ParsedActivityCode = { prefix: string; number: number };

const CODE_RE = /^([A-Za-z]+)(\d+)$/;

/** Parse codes like A1001, ARC12 — letter prefix + integer suffix. */
export function parseActivityCode(code: string): ParsedActivityCode | null {
  const trimmed = code.trim();
  const m = CODE_RE.exec(trimmed);
  if (m) {
    const number = Number.parseInt(m[2]!, 10);
    if (!Number.isFinite(number) || number < 0) return null;
    return { prefix: m[1]!.toUpperCase(), number };
  }
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

export function compareActivityCodes(a: string, b: string): number {
  const pa = parseActivityCode(a);
  const pb = parseActivityCode(b);
  if (pa && pb) {
    if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
    return pa.number - pb.number;
  }
  return a.localeCompare(b);
}

/** Dominant letter prefix used in a project (defaults to A). */
export function detectProjectCodePrefix(codes: string[]): string {
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

export async function listProjectActivityCodes(
  projectId: string,
  companyId: string
): Promise<string[]> {
  const rows = await prisma.activity.findMany({
    where: { projectId, companyId },
    select: { activityCode: true },
  });
  return rows.map((r) => r.activityCode);
}

function minActivityCodeOnDeliverable(activities: { activityCode: string }[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const a of activities) {
    const p = parseActivityCode(a.activityCode);
    if (p && p.number < min) min = p.number;
  }
  return min;
}

/** Deliverables by lowest activity ID (matches frontend sortDeliverablesByWorkflowOrder). */
function sortDeliverablesByWorkflowOrder<
  T extends { activities: Array<{ activityCode: string }> },
>(deliverables: T[]): T[] {
  return [...deliverables]
    .map((d, index) => ({ d, index, min: minActivityCodeOnDeliverable(d.activities) }))
    .sort((a, b) => {
      if (a.min !== b.min) return a.min - b.min;
      return a.index - b.index;
    })
    .map((x) => x.d);
}

type SequenceTreeActivity = { activityCode: string };
type SequenceTreeDeliverable = { id: string; activities: SequenceTreeActivity[] };
type SequenceTreeFragnet = { id: string; deliverables: SequenceTreeDeliverable[] };

/** Load every activity row for the project (flat queries — avoids missing nested includes). */
async function loadProjectTreeForSequence(
  projectId: string,
  companyId: string,
  excludeActivityId?: string
): Promise<SequenceTreeFragnet[]> {
  const [fragnets, deliverables, activities] = await Promise.all([
    prisma.fragnet.findMany({
      where: { projectId, companyId },
      orderBy: [{ createdAt: "asc" }, { name: "asc" }],
      select: { id: true },
    }),
    prisma.deliverable.findMany({
      where: { projectId, companyId },
      orderBy: { createdAt: "asc" },
      select: { id: true, fragnetId: true },
    }),
    prisma.activity.findMany({
      where: {
        projectId,
        companyId,
        ...(excludeActivityId ? { NOT: { id: excludeActivityId } } : {}),
      },
      select: { activityCode: true, fragnetId: true, deliverableId: true },
    }),
  ]);

  const activitiesByDeliverable = new Map<string, SequenceTreeActivity[]>();
  for (const a of activities) {
    if (!a.deliverableId) continue;
    const list = activitiesByDeliverable.get(a.deliverableId) ?? [];
    list.push({ activityCode: a.activityCode });
    activitiesByDeliverable.set(a.deliverableId, list);
  }

  const deliverablesByFragnet = new Map<string, SequenceTreeDeliverable[]>();
  for (const d of deliverables) {
    if (!d.fragnetId) continue;
    const list = deliverablesByFragnet.get(d.fragnetId) ?? [];
    list.push({
      id: d.id,
      activities: activitiesByDeliverable.get(d.id) ?? [],
    });
    deliverablesByFragnet.set(d.fragnetId, list);
  }

  return fragnets.map((f) => ({
    id: f.id,
    deliverables: deliverablesByFragnet.get(f.id) ?? [],
  }));
}

/**
 * Last sequential slot after a full schedule walk (same order as expandProjectWorkspaceData /
 * realignProjectActivityCodes): all fragnets → deliverables → activities, plus workflow clones
 * on empty deliverables.
 */
function computePresentationSequenceEnd(fragnets: SequenceTreeFragnet[]): number {
  let seq = 1001;
  let lastAssigned = 1000;

  for (const fragnet of fragnets) {
    const orderedDeliverables = sortDeliverablesByWorkflowOrder(fragnet.deliverables);
    const reference = orderedDeliverables.find((d) => d.activities.length > 0);
    let workflowActivities = reference
      ? [...reference.activities].sort((a, b) => compareActivityCodes(a.activityCode, b.activityCode))
      : [];

    for (const deliverable of orderedDeliverables) {
      if (deliverable.activities.length > 0) {
        const sorted = [...deliverable.activities].sort((a, b) =>
          compareActivityCodes(a.activityCode, b.activityCode)
        );
        for (const _ of sorted) {
          lastAssigned = seq;
          seq++;
        }
        workflowActivities = sorted;
      } else if (workflowActivities.length > 0) {
        for (const _ of workflowActivities) {
          lastAssigned = seq;
          seq++;
        }
      }
    }
  }

  return lastAssigned;
}

export type SystemActivitySequenceContext = {
  prefix: string;
  lastActivityCode: string | null;
  lastSequenceNumber: number;
  nextSequenceNumber: number;
  /** Rows in activities table for this project. */
  totalActivitiesInDatabase: number;
};

export async function getSystemActivitySequenceContext(
  projectId: string,
  companyId: string,
  excludeActivityId?: string
): Promise<SystemActivitySequenceContext> {
  const [fragnets, codes] = await Promise.all([
    loadProjectTreeForSequence(projectId, companyId, excludeActivityId),
    listProjectActivityCodes(projectId, companyId),
  ]);

  const prefix = detectProjectCodePrefix(codes.length > 0 ? codes : ["A1001"]);
  let maxParsed = 1000;
  for (const code of codes) {
    const p = parseActivityCode(code);
    if (p && p.prefix === prefix && p.number > maxParsed) maxParsed = p.number;
  }

  const presentationEnd = computePresentationSequenceEnd(fragnets);
  const lastSequenceNumber = Math.max(maxParsed, presentationEnd);

  return {
    prefix,
    lastActivityCode:
      lastSequenceNumber > 1000 ? formatActivityCode(prefix, lastSequenceNumber) : null,
    lastSequenceNumber,
    nextSequenceNumber: lastSequenceNumber + 1,
    totalActivitiesInDatabase: codes.length,
  };
}

/** Highest numeric suffix for a prefix across the whole project. */
export async function maxSequenceInProject(
  projectId: string,
  companyId: string,
  prefix: string
): Promise<number> {
  const codes = await listProjectActivityCodes(projectId, companyId);
  const p = prefix.toUpperCase();
  let max = 0;
  for (const code of codes) {
    const parsed = parseActivityCode(code);
    if (parsed?.prefix === p && parsed.number > max) max = parsed.number;
  }
  return max;
}

/** True if no activity in the project already uses this prefix+number. */
export async function isActivityCodeAvailableInProject(
  projectId: string,
  companyId: string,
  code: string,
  excludeActivityId?: string
): Promise<boolean> {
  const parsed = parseActivityCode(code);
  if (!parsed) return false;
  const activities = await prisma.activity.findMany({
    where: { projectId, companyId },
    select: { id: true, activityCode: true },
  });
  for (const a of activities) {
    if (excludeActivityId && a.id === excludeActivityId) continue;
    const other = parseActivityCode(a.activityCode);
    if (other?.prefix === parsed.prefix && other.number === parsed.number) return false;
  }
  return true;
}

/**
 * Resolve code for create/update: use user input when free, otherwise next sequential in project.
 */
export async function resolveSequentialActivityCode(opts: {
  projectId: string;
  companyId: string;
  fragnetId: string;
  userCode: string;
  excludeActivityId?: string;
}): Promise<string> {
  const trimmed = opts.userCode.trim().replace(/\s+/g, "");
  const parsed = parseActivityCode(trimmed);
  const codes = await listProjectActivityCodes(opts.projectId, opts.companyId);
  const prefix = parsed?.prefix ?? detectProjectCodePrefix(codes);

  if (parsed) {
    const candidate = formatActivityCode(parsed.prefix, parsed.number);
    const available = await isActivityCodeAvailableInProject(
      opts.projectId,
      opts.companyId,
      candidate,
      opts.excludeActivityId
    );
    if (available) {
      const inFragnet = await prisma.activity.findFirst({
        where: {
          companyId: opts.companyId,
          fragnetId: opts.fragnetId,
          activityCode: candidate,
          ...(opts.excludeActivityId ? { NOT: { id: opts.excludeActivityId } } : {}),
        },
        select: { id: true },
      });
      if (!inFragnet) return candidate;
    }
  }

  const seq = await getSystemActivitySequenceContext(
    opts.projectId,
    opts.companyId,
    opts.excludeActivityId
  );
  let n = seq.nextSequenceNumber;
  for (;;) {
    const candidate = formatActivityCode(prefix, n);
    const okProject = await isActivityCodeAvailableInProject(
      opts.projectId,
      opts.companyId,
      candidate,
      opts.excludeActivityId
    );
    const inFragnet = await prisma.activity.findFirst({
      where: {
        companyId: opts.companyId,
        fragnetId: opts.fragnetId,
        activityCode: candidate,
        ...(opts.excludeActivityId ? { NOT: { id: opts.excludeActivityId } } : {}),
      },
      select: { id: true },
    });
    if (okProject && !inFragnet) return candidate;
    n++;
    if (n > seq.nextSequenceNumber + 50_000) throw new Error("Could not allocate a unique activity code");
  }
}

export async function suggestNextActivityCode(
  projectId: string,
  companyId: string,
  excludeActivityId?: string
): Promise<string> {
  const ctx = await getSystemActivitySequenceContext(projectId, companyId, excludeActivityId);
  return formatActivityCode(ctx.prefix, ctx.nextSequenceNumber);
}

export type ActivityCodeAvailability = {
  available: boolean;
  normalizedCode: string | null;
  message: string;
  suggestedCode: string | null;
};

/** Whether a user-entered code can be used (project-wide sequence + unique per fragnet). */
export async function checkActivityCodeAvailability(opts: {
  projectId: string;
  companyId: string;
  fragnetId: string;
  userCode: string;
  excludeActivityId?: string;
}): Promise<ActivityCodeAvailability> {
  const trimmed = opts.userCode.trim().replace(/\s+/g, "");
  const seq = await getSystemActivitySequenceContext(
    opts.projectId,
    opts.companyId,
    opts.excludeActivityId
  );
  const suggestedCode = formatActivityCode(seq.prefix, seq.nextSequenceNumber);

  if (!trimmed) {
    return {
      available: false,
      normalizedCode: null,
      message: "Activity ID is required",
      suggestedCode,
    };
  }

  const parsed = parseActivityCode(trimmed);
  if (!parsed) {
    return {
      available: false,
      normalizedCode: null,
      message: "Use an ID like A1001 (letters + number), e.g. A1002, A1003",
      suggestedCode,
    };
  }

  const normalizedCode = formatActivityCode(parsed.prefix, parsed.number);

  let keepingOwnCode = false;
  if (opts.excludeActivityId) {
    const self = await prisma.activity.findFirst({
      where: {
        id: opts.excludeActivityId,
        projectId: opts.projectId,
        companyId: opts.companyId,
      },
      select: { activityCode: true },
    });
    const selfParsed = self?.activityCode ? parseActivityCode(self.activityCode) : null;
    if (
      selfParsed &&
      selfParsed.prefix === parsed.prefix &&
      selfParsed.number === parsed.number
    ) {
      keepingOwnCode = true;
    }
  }

  if (
    !keepingOwnCode &&
    seq.lastActivityCode &&
    parsed.prefix === seq.prefix.toUpperCase() &&
    parsed.number <= seq.lastSequenceNumber
  ) {
    return {
      available: false,
      normalizedCode,
      message: `${normalizedCode} is before the last position in this project (${seq.lastActivityCode}, ${seq.totalActivitiesInDatabase} activities in database). Use ${suggestedCode}.`,
      suggestedCode,
    };
  }

  const exactInProject = await prisma.activity.findFirst({
    where: {
      projectId: opts.projectId,
      companyId: opts.companyId,
      activityCode: normalizedCode,
      ...(opts.excludeActivityId ? { NOT: { id: opts.excludeActivityId } } : {}),
    },
    select: { id: true },
  });
  if (exactInProject) {
    return {
      available: false,
      normalizedCode,
      message: `${normalizedCode} is already used by an existing activity`,
      suggestedCode,
    };
  }

  const availableInProject = await isActivityCodeAvailableInProject(
    opts.projectId,
    opts.companyId,
    normalizedCode,
    opts.excludeActivityId
  );
  if (!availableInProject) {
    return {
      available: false,
      normalizedCode,
      message: `${normalizedCode} is already used in this project`,
      suggestedCode,
    };
  }

  const duplicateInFragnet = await prisma.activity.findFirst({
    where: {
      companyId: opts.companyId,
      fragnetId: opts.fragnetId,
      activityCode: normalizedCode,
      ...(opts.excludeActivityId ? { NOT: { id: opts.excludeActivityId } } : {}),
    },
    select: { id: true },
  });
  if (duplicateInFragnet) {
    return {
      available: false,
      normalizedCode,
      message: `${normalizedCode} already exists on this fragnet`,
      suggestedCode,
    };
  }

  return {
    available: true,
    normalizedCode,
    message: `${normalizedCode} is available`,
    suggestedCode,
  };
}

/** Allocate the next N sequential codes (for materialize / UI preview). */
export async function allocateSequentialCodes(
  projectId: string,
  companyId: string,
  count: number
): Promise<string[]> {
  const ctx = await getSystemActivitySequenceContext(projectId, companyId);
  const prefix = ctx.prefix;
  let n = ctx.nextSequenceNumber;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(formatActivityCode(prefix, n));
    n++;
  }
  return out;
}
