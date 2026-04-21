import { prisma } from "../utils/prisma.js";
import type { AuthedUser } from "./projectAccess.service.js";
import { requireProjectAccess } from "./projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";

export type ActivitySnapshot = {
  id: string;
  fragnetId: string;
  deliverableId: string;
  activityCode: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "LOCKED";
  bestDuration: number;
  likelyDuration: number;
  assuranceNoteId: string | null;
  assignedResources: unknown;
  projectId: string;
  companyId: string;
  createdAt: Date;
};

export type ActivityVersionItem = {
  version: number;
  createdAt: Date;
  auditLogId: string | null;
  action: string;
  userId: string | null;
  details: unknown;
  state: ActivitySnapshot;
};

const SNAPSHOT_FIELDS: Array<keyof ActivitySnapshot> = [
  "id",
  "fragnetId",
  "deliverableId",
  "activityCode",
  "name",
  "status",
  "bestDuration",
  "likelyDuration",
  "assuranceNoteId",
  "assignedResources",
  "projectId",
  "companyId",
  "createdAt",
];

function pickSnapshot(row: any): ActivitySnapshot {
  const out: any = {};
  for (const f of SNAPSHOT_FIELDS) out[f] = row[f];
  return out as ActivitySnapshot;
}

function applyUpdateDiffReverse(state: any, details: any): void {
  // Standard diff: { type:"update", changes:{ field:{from,to}}}
  if (!details || typeof details !== "object") return;
  if (details.type !== "update" || !details.changes || typeof details.changes !== "object") return;
  for (const [field, ch] of Object.entries(details.changes)) {
    if (!ch || typeof ch !== "object") continue;
    if (!("from" in (ch as any))) continue;
    (state as any)[field] = (ch as any).from;
  }
}

function applyStatusChangeReverse(state: any, details: any): void {
  // Status transition log: { from, to }
  if (!details || typeof details !== "object") return;
  if (!("from" in details) || !("to" in details)) return;
  // Only treat as status transition if it looks like enum values.
  const from = (details as any).from;
  const to = (details as any).to;
  if (typeof from === "string" && typeof to === "string") {
    state.status = from;
  }
}

function cloneState<T>(s: T): T {
  return JSON.parse(JSON.stringify(s));
}

export async function getActivityVersions(activityId: string, actor: AuthedUser): Promise<ActivityVersionItem[]> {
  const current = await prisma.activity.findFirst({ where: { id: activityId, companyId: actor.companyId } });
  if (!current) {
    const err = new Error("Activity not found");
    (err as any).status = 404;
    throw err;
  }

  const membership = await requireProjectAccess(current.projectId, actor);
  requirePermission(membership.role, "activity", "read");

  const logs = await prisma.auditLog.findMany({
    where: {
      companyId: actor.companyId,
      projectId: current.projectId,
      entity: "Activity",
      entityId: activityId,
      // Only logs that can affect versions:
      action: { in: ["UPDATE_ACTIVITY", "ACTIVITY_STATUS_CHANGED", "ACTIVITY_ROLLBACK"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  // Rewind from current state backwards using audit diffs (safe because we store from/to).
  const state: any = pickSnapshot(current);
  const reversedItems: ActivityVersionItem[] = [];

  // Version N is the current state. Each reversible log yields a prior version.
  reversedItems.push({
    version: 0,
    createdAt: current.createdAt,
    auditLogId: null,
    action: "CURRENT",
    userId: null,
    details: null,
    state: cloneState(state),
  });

  for (const log of logs) {
    if (log.action === "UPDATE_ACTIVITY") {
      applyUpdateDiffReverse(state, (log as any).details);
    } else if (log.action === "ACTIVITY_STATUS_CHANGED") {
      applyStatusChangeReverse(state, (log as any).details);
    } else {
      // rollback event itself doesn't change state; the actual changes are logged in UPDATE_ACTIVITY.
    }

    reversedItems.push({
      version: 0,
      createdAt: log.createdAt,
      auditLogId: log.id,
      action: log.action,
      userId: log.userId,
      details: (log as any).details,
      state: cloneState(state),
    });
  }

  // Oldest first, 1-indexed versions
  const oldestFirst = reversedItems.reverse();
  return oldestFirst.map((v, i) => ({ ...v, version: i + 1 }));
}

