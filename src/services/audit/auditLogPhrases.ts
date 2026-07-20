/** Plain-English phrases for every action written via auditLog() across the codebase. */
const AUDIT_ACTION_PHRASES: Record<string, string> = {
  ACCEPT_INVITATION: "accepted an invitation",
  ACTIVITY_APPROVED: "approved an activity",
  ACTIVITY_REJECTED: "rejected an activity",
  ACTIVITY_ROLLBACK: "rolled back an activity",
  ACTIVITY_STATUS_CHANGED: "changed an activity's status",
  ACTIVITY_SUBMITTED: "submitted an activity for approval",
  ADD_PROJECT_MEMBER: "added a project member",
  ADMIN_REQUEST_APPROVED: "approved an admin request",
  ADMIN_REQUEST_CREATED: "requested admin access",
  ADMIN_REQUEST_REJECTED: "rejected an admin request",
  CLEAR_RATE_CARD: "cleared the rate card",
  CREATE_ACTIVITY: "created an activity",
  CREATE_ASSURANCE_NOTE: "created an assurance note",
  CREATE_BASELINE_SNAPSHOT: "created a baseline snapshot",
  CREATE_DELIVERABLE: "created a deliverable",
  CREATE_DELIVERABLE_ACTIVITY_RELATIONSHIP: "linked a deliverable to an activity",
  CREATE_DELIVERABLE_RELATIONSHIP: "linked deliverables",
  CREATE_FRAGNET: "created a stage",
  CREATE_INVITATION: "sent an invitation",
  CREATE_PROJECT: "created this project",
  CREATE_PROJECT_FROM_XER: "imported this project from a P6 file",
  CREATE_RELATIONSHIP: "created an activity link",
  CREATE_STANDARD: "created a standard",
  DELETE_ACTIVITY: "deleted an activity",
  DELETE_ASSURANCE_NOTE: "deleted an assurance note",
  DELETE_DELIVERABLE: "deleted a deliverable",
  DELETE_DELIVERABLE_ACTIVITY_RELATIONSHIP: "removed a deliverable–activity link",
  DELETE_DELIVERABLE_RELATIONSHIP: "removed a deliverable link",
  DELETE_FRAGNET: "deleted a stage",
  DELETE_PROJECT: "deleted this project",
  DELETE_RELATIONSHIP: "removed an activity link",
  DELETE_STANDARD: "deleted a standard",
  DEV_DEMOTE_COMPANY_ADMIN: "changed a company admin role",
  DEV_SET_USER_ROLE: "changed a user's role",
  DRY_RUN_IMPORT_PROJECT_TEMPLATE: "previewed a project import",
  EXPORT_FRAGNET: "exported a stage",
  EXPORT_STANDARD: "exported a standard",
  IMPORT_PROGRAMME_SNAPSHOT: "imported a programme snapshot",
  IMPORT_PROJECT_TEMPLATE: "imported project data from a spreadsheet",
  JOIN_COMPANY: "joined the company",
  REGISTER: "registered an account",
  REGENERATE_JOIN_CODE: "regenerated the company join code",
  REMOVE_PROJECT_MEMBER: "removed a project member",
  UPDATE_ACTIVITY: "updated an activity",
  UPDATE_ASSURANCE_NOTE: "updated an assurance note",
  UPDATE_DELIVERABLE: "updated a deliverable",
  UPDATE_FRAGNET: "updated a stage",
  UPDATE_PROJECT: "updated this project",
  UPDATE_PROJECT_MEMBER_ROLE: "changed a project member's role",
  UPDATE_RELATIONSHIP: "updated an activity link",
  UPDATE_STANDARD: "updated a standard",
  UPLOAD_RATE_CARD: "uploaded a rate card",
};

export function auditActionPhrase(action: string): string {
  const key = action.trim();
  return AUDIT_ACTION_PHRASES[key] ?? "made a change";
}

export function resolveUserDisplayName(user: { name: string | null; email: string }): string {
  const name = user.name?.trim();
  if (name) return name;
  const email = user.email.trim();
  const prefix = email.split("@")[0]?.trim();
  if (prefix) return prefix;
  return email || "Someone";
}
