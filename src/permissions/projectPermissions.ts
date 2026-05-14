import type { ProjectMembership } from "../services/projectAccess.service.js";

export type ProjectRole = ProjectMembership["role"];
export type ProjectEntity =
  | "project"
  | "activity"
  | "activityCode"
  | "relationship"
  | "deliverable"
  | "standard"
  | "fragnet"
  | "assuranceNote"
  | "auditLog"
  | "rateCard"
  | "invitation"
  | "projectMember";

export type ProjectAction = "read" | "create" | "update" | "delete" | "manageMembers";

type PermissionMap = Record<ProjectEntity, Record<ProjectAction, readonly ProjectRole[]>>;

export type PermissionCheckResult =
  | { ok: true }
  | { ok: false; kind: "role"; message: "Forbidden" }
  | { ok: false; kind: "rule"; message: string };

export const permissions: PermissionMap = {
  project: {
    read: ["VIEWER", "EDITOR", "ADMIN"],
    create: ["EDITOR", "ADMIN"],
    update: ["EDITOR", "ADMIN"],
    delete: ["EDITOR", "ADMIN"],
    manageMembers: ["ADMIN"],
  },
  activity: {
    read: ["VIEWER", "EDITOR", "ADMIN"],
    create: ["EDITOR", "ADMIN"],
    update: ["EDITOR", "ADMIN"],
    delete: ["EDITOR", "ADMIN"],
    manageMembers: ["ADMIN"],
  },
  activityCode: {
    read: ["VIEWER", "EDITOR", "ADMIN"],
    create: ["EDITOR", "ADMIN"],
    update: ["EDITOR", "ADMIN"],
    delete: ["EDITOR", "ADMIN"],
    manageMembers: ["ADMIN"],
  },
  relationship: {
    read: ["VIEWER", "EDITOR", "ADMIN"],
    create: ["EDITOR", "ADMIN"],
    update: ["EDITOR", "ADMIN"],
    delete: ["EDITOR", "ADMIN"],
    manageMembers: ["ADMIN"],
  },
  deliverable: {
    read: ["VIEWER", "EDITOR", "ADMIN"],
    create: ["EDITOR", "ADMIN"],
    update: ["EDITOR", "ADMIN"],
    delete: ["EDITOR", "ADMIN"],
    manageMembers: ["ADMIN"],
  },
  standard: {
    read: ["VIEWER", "EDITOR", "ADMIN"],
    create: ["EDITOR", "ADMIN"],
    update: ["EDITOR", "ADMIN"],
    delete: ["EDITOR", "ADMIN"],
    manageMembers: ["ADMIN"],
  },
  fragnet: {
    read: ["VIEWER", "EDITOR", "ADMIN"],
    create: ["EDITOR", "ADMIN"],
    update: ["EDITOR", "ADMIN"],
    delete: ["EDITOR", "ADMIN"],
    manageMembers: ["ADMIN"],
  },
  assuranceNote: {
    read: ["VIEWER", "EDITOR", "ADMIN"],
    create: ["EDITOR", "ADMIN"],
    update: ["EDITOR", "ADMIN"],
    delete: ["EDITOR", "ADMIN"],
    manageMembers: ["ADMIN"],
  },
  auditLog: {
    read: ["ADMIN"],
    create: ["ADMIN"],
    update: ["ADMIN"],
    delete: ["ADMIN"],
    manageMembers: ["ADMIN"],
  },
  rateCard: {
    read: ["VIEWER", "EDITOR", "ADMIN"],
    create: ["EDITOR", "ADMIN"],
    update: ["EDITOR", "ADMIN"],
    delete: ["EDITOR", "ADMIN"],
    manageMembers: ["ADMIN"],
  },
  invitation: {
    read: ["ADMIN"],
    create: ["ADMIN"],
    update: ["ADMIN"],
    delete: ["ADMIN"],
    manageMembers: ["ADMIN"],
  },
  projectMember: {
    read: ["ADMIN"],
    create: ["ADMIN"],
    update: ["ADMIN"],
    delete: ["ADMIN"],
    manageMembers: ["ADMIN"],
  },
} as const;

type RuleFn = (context: unknown) => boolean | { ok: boolean; message?: string };
type RulesMap = Partial<Record<ProjectEntity, Partial<Record<ProjectAction, RuleFn>>>>;

// Contextual business rules layered on top of role-based permissions.
// Keep these simple and explicit; controllers should pass only the minimum context required.
export const rules: RulesMap = {
  // Activities: keep it simple like Deliverables (role-based only).
  projectMember: {
    delete: (ctx) => {
      const c = ctx as { isLastAdmin?: boolean } | null | undefined;
      return c?.isLastAdmin
        ? { ok: false, message: "Cannot remove the last project admin" }
        : { ok: true };
    },
    update: (ctx) => {
      const c = ctx as { isLastAdmin?: boolean; nextRole?: ProjectRole } | null | undefined;
      // Only block demotions/removals of the last admin.
      if (c?.isLastAdmin && c?.nextRole && c.nextRole !== "ADMIN") {
        return { ok: false, message: "Cannot demote the last project admin" };
      }
      return { ok: true };
    },
  },
};

function requireDefined(entity: ProjectEntity, action: ProjectAction): readonly ProjectRole[] {
  const entityDef = (permissions as any)[entity] as Record<string, readonly ProjectRole[]> | undefined;
  if (!entityDef) {
    throw new Error(`Permission not defined for entity/action: ${String(entity)}.${String(action)}`);
  }
  const allowed = (entityDef as any)[action] as readonly ProjectRole[] | undefined;
  if (!allowed) {
    throw new Error(`Permission not defined for entity/action: ${String(entity)}.${String(action)}`);
  }
  return allowed;
}

export function hasPermission(role: ProjectRole, entity: ProjectEntity, action: ProjectAction): boolean {
  return requireDefined(entity, action).includes(role);
}

export function checkPermission(
  role: ProjectRole,
  entity: ProjectEntity,
  action: ProjectAction,
  context?: unknown
): PermissionCheckResult {
  const allowedRoles = requireDefined(entity, action);
  if (!allowedRoles.includes(role)) {
    return { ok: false, kind: "role", message: "Forbidden" };
  }

  const rule = rules?.[entity]?.[action];
  if (!rule) return { ok: true };

  const outcome = rule(context);
  const ok = typeof outcome === "boolean" ? outcome : Boolean(outcome.ok);
  if (ok) return { ok: true };
  const message =
    typeof outcome === "object" && outcome && "message" in outcome && typeof (outcome as any).message === "string"
      ? String((outcome as any).message)
      : "Action not allowed in current state";
  return { ok: false, kind: "rule", message };
}

export function requirePermission(
  role: ProjectRole,
  entity: ProjectEntity,
  action: ProjectAction,
  context?: unknown
): void {
  const result = checkPermission(role, entity, action, context);
  if (result.ok) return;

  const err = new Error(result.message);
  (err as any).status = result.kind === "role" ? 403 : 409;
  (err as any).code = result.kind === "role" ? "FORBIDDEN" : "ACTION_NOT_ALLOWED";
  throw err;
}

