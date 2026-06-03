import axios, { type AxiosInstance, type AxiosError, type AxiosResponse } from "axios";
import { getStoredAuthToken } from "@/lib/auth-storage";
import { getInMemoryApprovalToken } from "@/lib/approval-token";

export function isAxiosError(err: unknown): err is AxiosError {
  return axios.isAxiosError(err);
}

function formatExportErrorPayload(data: {
  error?: unknown;
  message?: unknown;
  detail?: unknown;
  issues?: Array<{ message?: string; code?: string }>;
}): string {
  const parts: string[] = [];
  if (typeof data.error === "string" && data.error.trim()) parts.push(data.error.trim());
  if (typeof data.detail === "string" && data.detail.trim()) parts.push(data.detail.trim());
  if (typeof data.message === "string" && data.message.trim()) parts.push(data.message.trim());
  if (Array.isArray(data.issues) && data.issues.length > 0) {
    const issueText = data.issues
      .slice(0, 3)
      .map((i) => i.message ?? i.code)
      .filter(Boolean)
      .join("; ");
    if (issueText) parts.push(issueText);
  }
  return parts.join(" — ") || "Export failed";
}

export function getApiErrorMessage(err: unknown): string {
  if (!isAxiosError(err)) {
    return err instanceof Error && err.message ? err.message : "Something went wrong";
  }
  const data = err.response?.data;
  const status = err.response?.status;
  if (data && typeof data === "object" && !(data instanceof Blob)) {
    return formatExportErrorPayload(data as Parameters<typeof formatExportErrorPayload>[0]);
  }
  if (status === 403) return "You don’t have permission to perform this action.";
  if (err.code === "ERR_NETWORK" || !err.response)
    return "Cannot reach the server. Is the backend running?";
  if (status === 404) return "Not found.";
  if (status && status >= 500) return "Server error. Try again later.";
  return "Something went wrong.";
}

/** Parse JSON error bodies when axios used `responseType: "blob"` (export downloads). */
export async function getApiErrorMessageAsync(err: unknown): Promise<string> {
  if (isAxiosError(err) && err.response?.data instanceof Blob) {
    try {
      const text = await err.response.data.text();
      const j = JSON.parse(text) as Parameters<typeof formatExportErrorPayload>[0];
      const msg = formatExportErrorPayload(j);
      if (msg !== "Export failed") return msg;
      if (text.trim()) return text.trim().slice(0, 400);
    } catch {
      /* fall through */
    }
  }
  return getApiErrorMessage(err);
}

/**
 * When `responseType: "blob"`, success and error bodies are both Blobs. If the server sent JSON
 * (4xx/5xx/202 approval), parse it and throw so callers do not save error JSON as a .zip file.
 */
export async function assertBlobIsZipDownload(response: AxiosResponse<Blob>): Promise<Blob> {
  const raw =
    response.headers["content-type"] ??
    (response.headers as Record<string, string | undefined>)["Content-Type"] ??
    "";
  const contentType = String(raw).split(";")[0].trim().toLowerCase();
  if (contentType.includes("application/json") || contentType.includes("text/json")) {
    const text = await response.data.text();
    let message = "Request failed";
    let code: string | undefined;
    try {
      const j = JSON.parse(text) as Parameters<typeof formatExportErrorPayload>[0] & { code?: string };
      message = formatExportErrorPayload(j);
      if (message === "Export failed") {
        message =
          (typeof j.error === "string" && j.error) ||
          (typeof j.message === "string" && j.message) ||
          message;
      }
      code = typeof j.code === "string" ? j.code : undefined;
    } catch {
      if (text.trim()) message = text.trim().slice(0, 300);
    }
    const err = new Error(message) as Error & { code?: string; status?: number };
    err.code = code;
    err.status = response.status;
    throw err;
  }
  const blob = response.data;
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("Empty export file — the server returned no data.");
  }
  return blob;
}

const baseURL =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000")
    : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export const api: AxiosInstance = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
});

const PROJECT_ID_KEY = "rana4-project-id";

export function getStoredProjectId(): string | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(PROJECT_ID_KEY);
  return v && v.trim() !== "" ? v : null;
}

function requireProjectId(explicitProjectId?: string): string {
  const pid = (explicitProjectId ?? getStoredProjectId() ?? "").trim();
  if (!pid) {
    throw new Error("Project not selected");
  }
  return pid;
}

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = getStoredAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    config.headers.delete("Content-Type");
  }
  const approvalToken = getInMemoryApprovalToken();
  if (approvalToken && config.url && /^\/(rate-card|export)\b/.test(config.url)) {
    config.headers["X-Approval-Token"] = approvalToken;
  }
  return config;
});

api.interceptors.response.use((res) => res, (err) => Promise.reject(err));

export type User = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  role?: "ADMIN" | "EDITOR" | "VIEWER";
  emailVerified?: boolean;
  /** True when this sign-in may open /dev (server: DEV_PANEL_EMAIL or DEV_EMAILS). */
  devPanelAccess?: boolean;
};

export const authApi = {
  register: (data: {
    email: string;
    password: string;
    name?: string | null;
    inviteToken?: string;
    joinCode?: string;
    companyName?: string;
  }) => api.post<{ user: User; token: string }>("/auth/register", data),
  login: (data: { email: string; password: string }) => api.post<{ user: User; token: string }>("/auth/login", data),
  me: () => api.get<User>("/auth/me"),
  updateMe: (data: { name?: string }) => api.put<User>("/auth/me", data),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.put<unknown>("/auth/me/password", data),
};

export const companyApi = {
  getJoinCode: () => api.get<{ companyName: string; joinCode: string }>("/company/join-code"),
  regenerateJoinCode: () => api.post<{ joinCode: string }>("/company/regenerate-code"),
};

export type AdminRequestMine = {
  id: string;
  status: string;
  createdAt: string;
};

export type AdminPendingRequest = {
  id: string;
  createdAt: string;
  user: { id: string; email: string; name: string | null; role: string };
};

export const adminApi = {
  getMyRequest: () => api.get<{ request: AdminRequestMine | null }>("/admin/my-request"),
  createRequest: () => api.post<{ request: AdminRequestMine }>("/admin/request", {}),
  listPending: () => api.get<{ requests: AdminPendingRequest[] }>("/admin/requests"),
  approve: (id: string) => api.post<{ ok: boolean }>(`/admin/requests/${encodeURIComponent(id)}/approve`),
  reject: (id: string) => api.post<{ ok: boolean }>(`/admin/requests/${encodeURIComponent(id)}/reject`),
};

export type SecureApprovalRequest = {
  id: string;
  status: "pending" | "approved" | "denied" | "expired" | "revoked";
  createdAt: string;
  updatedAt: string;
  requestingUserId: string;
  resourceCategory: string;
  resourceId: string | null;
  resourceType: string | null;
  requestedAction: string;
  expiresAt: string | null;
};

export const secureApprovalsApi = {
  pending: (params?: { limit?: number; cursor?: string | null; resourceCategory?: string; resourceType?: string }) =>
    api.get<{ items: SecureApprovalRequest[]; nextCursor: string | null }>("/secure-approvals/pending", { params }),
  history: (params?: { limit?: number; cursor?: string | null; status?: string; resourceCategory?: string; resourceType?: string }) =>
    api.get<{ items: SecureApprovalRequest[]; nextCursor: string | null }>("/secure-approvals/history", { params }),
  approve: (id: string, body?: { reason?: string; expiresInMinutes?: number; maxDecryptCount?: number; maxBatchSize?: number }) =>
    api.post<{ ok: boolean; approval: SecureApprovalRequest; approvalToken?: string }>(
      `/secure-approvals/${encodeURIComponent(id)}/approve`,
      body ?? {}
    ),
  deny: (id: string, reason?: string) => api.post<{ ok: boolean; approval: SecureApprovalRequest }>(`/secure-approvals/${encodeURIComponent(id)}/deny`, { reason }),
  revoke: (id: string, reason?: string) => api.post<{ ok: boolean; approval: SecureApprovalRequest }>(`/secure-approvals/${encodeURIComponent(id)}/revoke`, { reason }),
};

export type DevAdminRequestRow = {
  id: string;
  createdAt: string;
  user: { email: string; companyName: string };
};

export type DevCompanyRow = { id: string; name: string; userCount: number };
export type DevUserRow = { id: string; email: string; role: string; companyName: string };

export const devApi = {
  listAdminRequests: () => api.get<{ requests: DevAdminRequestRow[] }>("/dev/admin-requests"),
  approveAdminRequest: (id: string) =>
    api.post<{ ok: boolean }>(`/dev/admin-requests/${encodeURIComponent(id)}/approve`),
  rejectAdminRequest: (id: string) =>
    api.post<{ ok: boolean }>(`/dev/admin-requests/${encodeURIComponent(id)}/reject`),
  listCompanies: () => api.get<{ companies: DevCompanyRow[] }>("/dev/companies"),
  listUsers: () => api.get<{ users: DevUserRow[] }>("/dev/users"),
  demoteUser: (id: string, role: "EDITOR" | "VIEWER") =>
    api.post<{ ok: boolean }>(`/dev/users/${encodeURIComponent(id)}/demote`, { role }),
  setUserRole: (id: string, role: "ADMIN" | "EDITOR" | "VIEWER") =>
    api.post<{ ok: boolean }>(`/dev/users/${encodeURIComponent(id)}/set-role`, { role }),
};

export const invitationsApi = {
  invite: (data: { email: string; projectId?: string }) =>
    api.post<{ invitation: { id: string; email: string; role: "ADMIN" | "EDITOR" | "VIEWER"; token: string; expiresAt: string; createdAt: string } }>(
      "/invite",
      { ...data, projectId: requireProjectId(data.projectId) }
    ),
};

export type Project = {
  id: string;
  name: string;
  companyId?: string;
  myRole?: "ADMIN" | "EDITOR" | "VIEWER";
};

export type ProjectMemberRow = {
  userId: string;
  projectId: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
  email: string;
  name: string | null;
};

export type ActivityCodeAvailability = {
  available: boolean;
  normalizedCode: string | null;
  message: string;
  suggestedCode: string | null;
};

export const projectsApi = {
  listMine: () => api.get<Project[]>("/projects"),
  create: (data: { name: string }) => api.post<Project>("/projects", data),
  update: (projectId: string, data: { name: string }) =>
    api.put<Project>(`/projects/${encodeURIComponent(projectId)}`, data),
  delete: (projectId: string, opts?: { force?: boolean }) =>
    api.delete<void>(`/projects/${encodeURIComponent(projectId)}`, {
      params: opts?.force ? { force: "true" } : undefined,
    }),
  listMembers: (projectId: string) =>
    api.get<{ members: ProjectMemberRow[] }>(`/projects/${encodeURIComponent(projectId)}/members`),
  addMember: (projectId: string, data: { userId: string; role?: "ADMIN" | "EDITOR" | "VIEWER" }) =>
    api.post(`/projects/${projectId}/members`, data),
  updateMemberRole: (projectId: string, userId: string, data: { role: "ADMIN" | "EDITOR" | "VIEWER" }) =>
    api.patch(`/projects/${projectId}/members/${userId}`, data),
  removeMember: (projectId: string, userId: string) =>
    api.delete(`/projects/${projectId}/members/${userId}`),
  recalculateSchedule: (
    projectId: string,
    data?: { startDate?: string; scenario?: "best" | "likely"; persist?: boolean }
  ) =>
    api.post<ScheduleRecalculateResult>(`/projects/${projectId}/recalculate-schedule`, data ?? {}),
  getScheduleNetwork: (projectId: string) =>
    api.get<ScheduleNetworkResponse>(`/projects/${projectId}/schedule-network`),
  getCriticalPath: (projectId: string) =>
    api.get<ScheduleCriticalPathResponse>(`/projects/${projectId}/critical-path`),
  getSuggestedActivityCode: (projectId: string, excludeActivityId?: string) =>
    api.get<{ activityCode: string }>(`/projects/${encodeURIComponent(projectId)}/suggested-activity-code`, {
      params: excludeActivityId ? { excludeActivityId } : undefined,
    }),
  checkActivityCodeAvailability: (
    projectId: string,
    params: { code: string; fragnetId: string; excludeActivityId?: string }
  ) =>
    api.get<ActivityCodeAvailability>(
      `/projects/${encodeURIComponent(projectId)}/activity-code-availability`,
      { params }
    ),
};

export type IntelligenceFinding = {
  findingType: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  summary: string;
  reasoning: string[];
  evidence: { label: string; value: string | number }[];
};

export type IntelligenceDriver = {
  driverType: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  confidenceScore: number;
  impactLevel: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  summary: string;
  reasoning: string[];
  evidence: { label: string; value: string | number }[];
};

export const intelligenceApi = {
  getDeliverableBenchmark: (projectId: string, deliverableId: string, opts?: { projectIds?: string[] }) => {
    const pid = requireProjectId(projectId);
    const projectIds = (opts?.projectIds ?? []).filter(Boolean);
    return api.get(`/projects/${encodeURIComponent(pid)}/intelligence/benchmark/${encodeURIComponent(deliverableId)}`, {
      params: projectIds.length ? { projectIds: projectIds.join(",") } : undefined,
    });
  },
  getDeliverableFindings: (projectId: string, deliverableId: string, opts?: { projectIds?: string[] }) => {
    const pid = requireProjectId(projectId);
    const projectIds = (opts?.projectIds ?? []).filter(Boolean);
    return api.get<{ findings: IntelligenceFinding[] }>(
      `/projects/${encodeURIComponent(pid)}/intelligence/findings/${encodeURIComponent(deliverableId)}`,
      {
        params: projectIds.length ? { projectIds: projectIds.join(",") } : undefined,
      }
    );
  },
  getDeliverableDrivers: (projectId: string, deliverableId: string, opts?: { projectIds?: string[] }) => {
    const pid = requireProjectId(projectId);
    const projectIds = (opts?.projectIds ?? []).filter(Boolean);
    return api.get<{ drivers: IntelligenceDriver[] }>(
      `/projects/${encodeURIComponent(pid)}/intelligence/drivers/${encodeURIComponent(deliverableId)}`,
      {
        params: projectIds.length ? { projectIds: projectIds.join(",") } : undefined,
      }
    );
  },
};

export type ScheduleDiagnostic = {
  code: string;
  severity: "critical" | "warning" | "advisory" | "info";
  message: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
};

export type ScheduleNetworkActivity = {
  id: string;
  activityCode: string;
  earlyStart: string | null;
  earlyFinish: string | null;
  lateStart: string | null;
  lateFinish: string | null;
  totalFloat: number | null;
  freeFloat: number | null;
  isCritical: boolean;
};

export type ScheduleNetworkRelationship = {
  id: string;
  predecessorActivityId: string;
  successorActivityId: string;
  relationshipType: RelationshipType;
  lag: number;
};

export type ScheduleRecalculateResult = {
  ok: boolean;
  projectStart: string | null;
  projectEnd: string | null;
  scenario: "best" | "likely";
  activities: Array<
    ScheduleNetworkActivity & {
      durationDays?: number;
      drivingRelationshipId?: string | null;
      plannedStartDate?: string | null;
      plannedFinishDate?: string | null;
    }
  >;
  criticalPathActivityIds: string[];
  network?: {
    activityIds: string[];
    relationshipIds: string[];
    topologicalOrder: string[];
    cycleActivityIds: string[][];
    disconnectedComponents: string[][];
  };
  diagnostics: ScheduleDiagnostic[];
};

export type ScheduleNetworkResponse = {
  projectStart: string | null;
  network: {
    activityIds: string[];
    relationshipIds: string[];
    topologicalOrder: string[];
    cycleActivityIds: string[][];
    disconnectedComponents: string[][];
  };
  relationships: ScheduleNetworkRelationship[];
  deliverableRelationships: DeliverableRelationship[];
  deliverableActivityRelationships: DeliverableActivityRelationship[];
  activityToDeliverableRelationships: ActivityToDeliverableRelationship[];
  activities: ScheduleNetworkActivity[];
  diagnostics: ScheduleDiagnostic[];
};

export type ScheduleCriticalPathResponse = {
  count: number;
  activities: Array<{
    id: string;
    activityCode: string;
    name: string;
    fragnetId: string;
    earlyStart: string | null;
    earlyFinish: string | null;
    totalFloat: number | null;
  }>;
};

export type Standard = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

export const standardsApi = {
  list: (projectId?: string) => api.get<Standard[]>("/standards", { params: { projectId: requireProjectId(projectId) } }),
  get: (id: string) => api.get<Standard>(`/standards/${id}`),
  create: (data: { projectId?: string; name: string; description?: string }) =>
    api.post<Standard>("/standards", { ...data, projectId: requireProjectId(data.projectId) }),
  update: (id: string, data: { name?: string; description?: string }) =>
    api.put<Standard>(`/standards/${id}`, data),
  delete: (id: string) => api.delete(`/standards/${id}`),
};

export type Fragnet = {
  id: string;
  standardId: string;
  name: string;
  description: string | null;
  createdAt: string;
};

export type RateCardEntry = {
  resourceType: string;
  resourceName: string;
  unit: string;
  rate: number;
};

export type AssignedResource = {
  resourceType: string;
  resourceName: string;
  rate: number;
  unit: string;
  units?: number;
};

export const rateCardApi = {
  get: () =>
    api.get<{
      entries: RateCardEntry[];
      types: string[];
      summary: { type: string; count: number }[];
    }>("/rate-card"),
  /** Replaces the entire rate card. Field name must be `file`. */
  upload: (file: File, projectId?: string) => {
    const body = new FormData();
    body.append("file", file);
    return api.post<{ ok: boolean; count: number; message: string }>("/rate-card/upload", body, { params: { projectId: requireProjectId(projectId) } });
  },
  /** Deletes every rate card row in the database. */
  clear: (projectId?: string) => api.delete<{ ok: boolean; message: string }>("/rate-card", { params: { projectId: requireProjectId(projectId) } }),
};

export const fragnetsApi = {
  listByStandard: (standardId: string) =>
    api.get<Fragnet[]>(`/fragnets/standard/${standardId}`),
  get: (id: string) => api.get<Fragnet>(`/fragnets/${id}`),
  create: (data: { standardId: string; name: string; description?: string }) =>
    api.post<Fragnet>("/fragnets", data),
  update: (id: string, data: { name?: string; description?: string }) =>
    api.put<Fragnet>(`/fragnets/${id}`, data),
  delete: (id: string) => api.delete(`/fragnets/${id}`),
  listActivityTemplates: (fragnetId: string) =>
    api.get<FragnetActivityTemplate[]>(`/fragnets/${fragnetId}/activity-templates`),
  createActivityTemplate: (
    fragnetId: string,
    data: {
      templateCode: string;
      name: string;
      bestDuration: number;
      likelyDuration: number;
      isSharedAcrossDeliverables?: boolean;
      orderIndex?: number;
      assignedResources?: { resourceType: string; resourceName: string; units?: number }[];
      activityCodeByTypeId?: Record<string, string | null>;
    }
  ) => api.post<FragnetActivityTemplate>(`/fragnets/${fragnetId}/activity-templates`, data),
  updateActivityTemplate: (
    fragnetId: string,
    templateId: string,
    data: Partial<{
      name: string;
      bestDuration: number;
      likelyDuration: number;
      isSharedAcrossDeliverables: boolean;
      orderIndex: number;
      assignedResources: { resourceType: string; resourceName: string; units?: number }[];
      activityCodeByTypeId?: Record<string, string | null>;
    }>
  ) => api.put<FragnetActivityTemplate>(`/fragnets/${fragnetId}/activity-templates/${templateId}`, data),
  deleteActivityTemplate: (fragnetId: string, templateId: string) =>
    api.delete(`/fragnets/${fragnetId}/activity-templates/${templateId}`),
  createTemplateRelationship: (
    fragnetId: string,
    data: {
      predecessorTemplateId: string;
      successorTemplateId: string;
      relationshipType: RelationshipType;
      lag?: number;
    }
  ) => api.post(`/fragnets/${fragnetId}/activity-templates/relationships`, data),
  syncActivityTemplates: (fragnetId: string) =>
    api.post<{ updated: number; deliverables: number; activities: number; relationships: number }>(
      `/fragnets/${fragnetId}/activity-templates/sync`
    ),
  materializeActivityTemplates: (fragnetId: string) =>
    api.post<{
      deliverables: number;
      activities: number;
      relationships: number;
      codesRealigned?: number;
    }>(`/fragnets/${fragnetId}/activity-templates/materialize`),
  realignActivityCodes: (fragnetId: string) =>
    api.post<{ updated: number }>(`/fragnets/${fragnetId}/activity-templates/realign-codes`),
};

export type ActivityCodeValue = {
  id: string;
  typeId: string;
  parentId: string | null;
  name: string;
  shortName: string | null;
  seqNum: number;
  color: string | null;
  createdAt?: string;
};

export type ActivityCodeType = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  seqNum: number;
  createdAt: string;
  codes?: ActivityCodeValue[];
};

export type ActivityCodeAssignmentRow = {
  id: string;
  activityId?: string | null;
  deliverableId?: string | null;
  typeId: string;
  codeId: string;
  type: { id: string; name: string; slug: string };
  code: { id: string; name: string; typeId: string };
};

export type Activity = {
  id: string;
  fragnetId: string;
  deliverableId?: string;
  linkedDeliverables?: Array<{ id: string; name: string; fragnetId?: string | null; projectId?: string; isPrimary?: boolean }>;
  activityCode: string;
  name: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "LOCKED";
  bestDuration: number;
  likelyDuration: number;
  assuranceNoteId: string | null;
  assignedResources?: AssignedResource[];
  activityCodeAssignments?: ActivityCodeAssignmentRow[];
  isSharedAcrossDeliverables?: boolean;
  isInherited?: boolean;
  templateActivityId?: string | null;
  detachedFromTemplate?: boolean;
  plannedStartDate?: string | null;
  plannedFinishDate?: string | null;
  earlyStart?: string | null;
  earlyFinish?: string | null;
  lateStart?: string | null;
  lateFinish?: string | null;
  totalFloat?: number | null;
  freeFloat?: number | null;
  isCritical?: boolean;
  drivingRelationshipId?: string | null;
  createdAt: string;
};

export type FragnetActivityTemplate = {
  id: string;
  fragnetId: string;
  templateCode: string;
  name: string;
  bestDuration: number;
  likelyDuration: number;
  isSharedAcrossDeliverables?: boolean;
  orderIndex: number;
  assignedResources?: AssignedResource[];
  activityCodeAssignments?: ActivityCodeAssignmentRow[];
  predecessorIn: {
    id: string;
    predecessorTemplateId: string;
    successorTemplateId: string;
    relationshipType: RelationshipType;
    lag: number;
  }[];
  successorIn: {
    id: string;
    predecessorTemplateId: string;
    successorTemplateId: string;
    relationshipType: RelationshipType;
    lag: number;
  }[];
};

export const activitiesApi = {
  getProjectLevelContext: (projectId: string) =>
    api.get<{ standardId: string | null; fragnetId: string | null; deliverables: Deliverable[]; activities: Activity[] }>(
      `/activities/project/${encodeURIComponent(projectId)}/project-level`
    ),
  listByFragnet: (fragnetId: string) =>
    api.get<Activity[]>(`/activities/fragnet/${fragnetId}`),
  get: (id: string) => api.get<Activity>(`/activities/${id}`),
  create: (data: {
    projectId?: string;
    fragnetId?: string;
    deliverableId?: string;
    deliverableIds?: string[];
    activityCode: string;
    name: string;
    bestDuration: number;
    likelyDuration: number;
    assuranceNoteId?: string | null;
    assignedResources?: { resourceType: string; resourceName: string; units?: number }[];
    isSharedAcrossDeliverables?: boolean;
    activityCodeByTypeId?: Record<string, string | null>;
  }) => api.post<Activity>("/activities", data),
  update: (id: string, data: {
    activityCode?: string;
    name?: string;
    deliverableId?: string;
    deliverableIds?: string[];
    bestDuration?: number;
    likelyDuration?: number;
    assuranceNoteId?: string | null;
    assignedResources?: { resourceType: string; resourceName: string; units?: number }[];
    isSharedAcrossDeliverables?: boolean;
    activityCodeByTypeId?: Record<string, string | null>;
  }) => api.put<Activity>(`/activities/${id}`, data),
  updateStatus: (id: string, status: Activity["status"]) =>
    api.patch<Activity>(`/activities/${id}/status`, { status }),
  submit: (id: string, comment?: string) =>
    api.patch<Activity>(`/activities/${id}/submit`, { comment }),
  approve: (id: string, comment?: string) =>
    api.patch<Activity>(`/activities/${id}/approve`, { comment }),
  reject: (id: string, comment?: string) =>
    api.patch<Activity>(`/activities/${id}/reject`, { comment }),
  getVersions: (id: string) =>
    api.get<{ versions: Array<{ version: number; createdAt: string; action: string; userId: string | null; details: any; state: Activity }> }>(
      `/activities/${id}/versions`
    ),
  rollback: (id: string, targetVersion: number) =>
    api.post<{ updated: Activity; fromVersion: number; toVersion: number }>(`/activities/${id}/rollback`, { targetVersion }),
  delete: (id: string) => api.delete(`/activities/${id}`),
  bulkDelete: (ids: string[]) =>
    api.post<{ deleted: string[]; failed: { id: string; error: string }[] }>("/activities/bulk-delete", { ids }),
  detachFromTemplate: (id: string) => api.patch<Activity>(`/activities/${id}/detach-from-template`),
};

export const activityCodeTypesApi = {
  list: (projectId?: string) =>
    api.get<ActivityCodeType[]>("/activity-code-types", { params: { projectId: requireProjectId(projectId) } }),
  create: (data: { projectId?: string; name: string; slug?: string; shortName?: string | null; seqNum?: number }) =>
    api.post<ActivityCodeType>("/activity-code-types", { ...data, projectId: requireProjectId(data.projectId) }),
  update: (
    id: string,
    data: { projectId?: string; name?: string; slug?: string; shortName?: string | null; seqNum?: number }
  ) => api.put<ActivityCodeType>(`/activity-code-types/${encodeURIComponent(id)}`, { ...data, projectId: requireProjectId(data.projectId) }),
  delete: (id: string, projectId?: string) =>
    api.delete(`/activity-code-types/${encodeURIComponent(id)}`, { params: { projectId: requireProjectId(projectId) } }),
};

export const activityCodesApi = {
  listByType: (typeId: string, projectId?: string) =>
    api.get<ActivityCodeValue[]>("/activity-codes", {
      params: { typeId, projectId: requireProjectId(projectId) },
    }),
  create: (data: {
    projectId?: string;
    typeId: string;
    name: string;
    shortName?: string | null;
    parentId?: string | null;
    seqNum?: number;
    color?: string | null;
  }) => api.post<ActivityCodeValue>("/activity-codes", { ...data, projectId: requireProjectId(data.projectId) }),
  update: (
    id: string,
    data: {
      projectId?: string;
      name?: string;
      shortName?: string | null;
      parentId?: string | null;
      seqNum?: number;
      color?: string | null;
    }
  ) => api.put<ActivityCodeValue>(`/activity-codes/${encodeURIComponent(id)}`, { ...data, projectId: requireProjectId(data.projectId) }),
  delete: (id: string, projectId?: string) =>
    api.delete(`/activity-codes/${encodeURIComponent(id)}`, { params: { projectId: requireProjectId(projectId) } }),
};

export type RelationshipType = "FS" | "SS" | "FF" | "SF";

export type Relationship = {
  id: string;
  fragnetId: string;
  predecessorActivityId: string;
  successorActivityId: string;
  relationshipType: RelationshipType;
  lag: number;
};

export type DeliverableRelationship = {
  id: string;
  fragnetId: string;
  predecessorDeliverableId: string;
  successorDeliverableId: string;
  relationshipType: RelationshipType;
  lag: number;
};

export type DeliverableActivityRelationship = {
  id: string;
  fragnetId: string;
  predecessorDeliverableId: string;
  successorActivityId: string;
  relationshipType: RelationshipType;
  lag: number;
};

export type ActivityToDeliverableRelationship = {
  id: string;
  fragnetId: string;
  predecessorActivityId: string;
  successorDeliverableId: string;
  relationshipType: RelationshipType;
  lag: number;
};

export const deliverableRelationshipsApi = {
  listByFragnet: (fragnetId: string) =>
    api.get<DeliverableRelationship[]>(`/deliverable-relationships/fragnet/${fragnetId}`),
  create: (data: {
    fragnetId?: string;
    predecessorDeliverableId: string;
    successorDeliverableId: string;
    relationshipType: RelationshipType;
    lag?: number;
  }) => api.post<DeliverableRelationship>("/deliverable-relationships", data),
  delete: (id: string) => api.delete(`/deliverable-relationships/${id}`),
};

export const activityToDeliverableRelationshipsApi = {
  listByFragnet: (fragnetId: string) =>
    api.get<ActivityToDeliverableRelationship[]>(
      `/activity-to-deliverable-relationships/fragnet/${fragnetId}`
    ),
};

export const deliverableActivityRelationshipsApi = {
  listByFragnet: (fragnetId: string) =>
    api.get<DeliverableActivityRelationship[]>(
      `/deliverable-activity-relationships/fragnet/${fragnetId}`
    ),
  create: (data: {
    fragnetId?: string;
    predecessorDeliverableId: string;
    successorActivityId: string;
    relationshipType: RelationshipType;
    lag?: number;
  }) => api.post<DeliverableActivityRelationship>("/deliverable-activity-relationships", data),
  delete: (id: string) => api.delete(`/deliverable-activity-relationships/${id}`),
};

export const relationshipsApi = {
  listByFragnet: (fragnetId: string) =>
    api.get<Relationship[]>(`/relationships/fragnet/${fragnetId}`),
  create: (data: {
    fragnetId: string;
    predecessorActivityId: string;
    successorActivityId: string;
    relationshipType: RelationshipType;
    lag?: number;
  }) => api.post<Relationship>("/relationships", data),
  update: (
    id: string,
    data: { relationshipType?: RelationshipType; lag?: number }
  ) => api.put<Relationship>(`/relationships/${id}`, data),
  delete: (id: string) => api.delete(`/relationships/${id}`),
};

export type Deliverable = {
  id: string;
  fragnetId: string | null;
  name: string;
  classification?: string | null;
  bestDuration: number;
  likelyDuration: number;
  assignedResources?: AssignedResource[];
  activityCodeAssignments?: ActivityCodeAssignmentRow[];
  createdAt: string;
};

export const deliverablesApi = {
  /** List all deliverables, optionally filter by fragnetId. */
  list: (projectId?: string, fragnetId?: string) => {
    const pid = requireProjectId(projectId);
    return api.get<Deliverable[]>("/deliverables", fragnetId ? { params: { projectId: pid, fragnetId } } : { params: { projectId: pid } });
  },
  /** List deliverables for a fragnet. */
  listByFragnet: (fragnetId: string) =>
    api.get<Deliverable[]>(`/deliverables/fragnet/${fragnetId}`),
  get: (id: string) => api.get<Deliverable>(`/deliverables/${id}`),
  create: (data: {
    projectId?: string;
    fragnetId?: string | null;
    name: string;
    bestDuration: number;
    likelyDuration: number;
    assignedResources?: { resourceType: string; resourceName: string; units?: number }[];
    externalProjectId?: string | null;
    activityCodeByTypeId?: Record<string, string | null>;
  }) => api.post<Deliverable>("/deliverables", { ...data, projectId: requireProjectId(data.projectId) }),
  update: (id: string, data: {
    fragnetId?: string | null;
    name?: string;
    bestDuration?: number;
    likelyDuration?: number;
    assignedResources?: { resourceType: string; resourceName: string; units?: number }[];
    externalProjectId?: string | null;
    activityCodeByTypeId?: Record<string, string | null>;
  }) => api.put<Deliverable>(`/deliverables/${id}`, data),
  delete: (id: string) => api.delete(`/deliverables/${id}`),
};

export type AssuranceNote = {
  id: string;
  standardId: string;
  noteText: string;
  createdAt: string;
};

export type AuditLogItem = {
  id: string;
  userId: string;
  companyId: string;
  projectId: string;
  action: string;
  entity: string;
  entityId: string | null;
  details?: any;
  createdAt: string;
};

export const auditLogsApi = {
  list: (params?: {
    projectId?: string;
    userId?: string;
    action?: string;
    entity?: string;
    entityId?: string;
    limit?: number;
    cursor?: string | null;
  }) =>
    api.get<{ items: AuditLogItem[]; nextCursor: string | null }>("/audit-logs", {
      params: {
        projectId: requireProjectId(params?.projectId),
        userId: params?.userId?.trim() || undefined,
        action: params?.action?.trim() || undefined,
        entity: params?.entity?.trim() || undefined,
        entityId: params?.entityId?.trim() || undefined,
        limit: params?.limit,
        cursor: params?.cursor ?? undefined,
      },
    }),
};

export const assuranceNotesApi = {
  listByStandard: (standardId: string) =>
    api.get<AssuranceNote[]>(`/assurance-notes/standard/${standardId}`),
  create: (data: { standardId: string; noteText: string }) =>
    api.post<AssuranceNote>("/assurance-notes", data),
  delete: (id: string) => api.delete(`/assurance-notes/${id}`),
};

export const exportApi = {
  /** Downloads ZIP (Excel + WBS review + XER). POST: scenario, projectName, projectId. Deliverables must belong to a stage (fragnet). */
  fragnet: (
    fragnetId: string,
    body: {
      scenario: "best" | "likely";
      projectName: string;
      projectId: string;
    }
  ) =>
    api.post<Blob>(`/export/fragnet/${fragnetId}`, body, {
      responseType: "blob",
    }),

  /** Downloads ZIP export for the full standard (Project → Fragnet → Deliverable WBS). */
  standard: (
    standardId: string,
    body: {
      scenario: "best" | "likely";
      projectName: string;
      projectId: string;
    }
  ) =>
    api.post<Blob>(`/export/standard/${standardId}`, body, {
      responseType: "blob",
    }),

  validateStandardActivities: (standardId: string) =>
    api.get<{ ok: boolean; result?: { activityCount: number; orphanActivities: any[]; unknownDeliverableActivities: any[]; crossFragnetMismatches: any[] }; error?: string }>(
      `/export/standard/${standardId}/validate-activities`
    ),

  /** Dry-run: same pipeline as ZIP export (WBS, XLSX, XER validation) without downloading. */
  preflightStandard: (
    standardId: string,
    body: { scenario: "best" | "likely"; projectName: string; projectId: string }
  ) => api.post<ExportPreflightResponse>(`/export/standard/${standardId}/preflight`, body),

  preflightFragnet: (
    fragnetId: string,
    body: { scenario: "best" | "likely"; projectName: string; projectId: string }
  ) => api.post<ExportPreflightResponse>(`/export/fragnet/${fragnetId}/preflight`, body),
};

export type ExportPreflightIssue = {
  phase: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  fragnetId?: string;
};

export type ExportPreflightResponse = {
  ok: boolean;
  issues: ExportPreflightIssue[];
  errorCount: number;
  warningCount: number;
  assignment?: {
    activityCount: number;
    orphanActivities: { id: string }[];
    unknownDeliverableActivities: { id: string }[];
    crossFragnetMismatches: { id: string }[];
  };
};

/** Programme intelligence — snapshots, planned vs actual, portfolio learning */
export type ProgrammeSnapshotSummary = {
  id: string;
  projectId: string;
  importedAt: string;
  sourceType: string;
  snapshotRole: string | null;
  scheduleDate: string | null;
  label: string | null;
  snapshotVersion: number;
  metrics: Record<string, unknown>;
  importSummary: Record<string, unknown>;
  activityCount: number;
  deliverableCount: number;
};

export type ProgrammeImportResult = {
  snapshotId: string;
  summary: ProgrammeSnapshotSummary;
  matchResult: {
    matchedActivities: number;
    unmatchedActivityCodes: string[];
    matchedDeliverables: number;
    unmatchedDeliverableNames: string[];
    matchedRelationships: number;
    unmatchedRelationships: number;
  };
};

export type PlannedVsActualReport = {
  baselineSnapshotId: string;
  comparisonSnapshotId: string;
  generatedAt: string;
  activityVariances: Array<{
    activityCode: string;
    durationVarianceDays: number | null;
    finishVarianceDays: number | null;
    floatErosionDays: number | null;
    becameCritical: boolean;
  }>;
  projectSummary: {
    criticalPathInstability: number;
    activitiesWithDurationVariance: number;
    activitiesWithFloatErosion: number;
    highRiskAreas: string[];
  };
};

export type LessonFinding = {
  id: string;
  title: string;
  summary: string;
  severity: string;
  sampleSize: number;
};

export const programmeIntelligenceApi = {
  listSnapshots: (projectId: string) =>
    api.get<{ snapshots: ProgrammeSnapshotSummary[] }>(
      `/projects/${encodeURIComponent(projectId)}/programme-snapshots`
    ),
  importProgramme: (projectId: string, file: File, opts?: { snapshotRole?: string; label?: string }) => {
    const form = new FormData();
    form.append("file", file);
    if (opts?.snapshotRole) form.append("snapshotRole", opts.snapshotRole);
    if (opts?.label) form.append("label", opts.label);
    return api.post<ProgrammeImportResult>(
      `/projects/${encodeURIComponent(projectId)}/programme-import`,
      form
    );
  },
  createBaseline: (projectId: string, label?: string) =>
    api.post<{ snapshotId: string; summary: ProgrammeSnapshotSummary }>(
      `/projects/${encodeURIComponent(projectId)}/programme-snapshots/baseline`,
      { label: label ?? "Generated baseline" }
    ),
  plannedVsActual: (
    projectId: string,
    params: { baselineSnapshotId: string; comparisonSnapshotId?: string; compareToLive?: boolean }
  ) =>
    api.get<PlannedVsActualReport>(
      `/projects/${encodeURIComponent(projectId)}/planned-vs-actual`,
      { params }
    ),
  exportProgrammeJson: (projectId: string) =>
    api.get<Blob>(`/projects/${encodeURIComponent(projectId)}/programme-export`, {
      responseType: "blob",
    }),
  portfolioBenchmarks: (params?: { projectType?: string; ribaStage?: string }) =>
    api.get<{ metrics: Array<{ key: string; label: string; average: number; sampleSize: number; unit: string }> }>(
      "/intelligence/portfolio-benchmarks",
      { params }
    ),
  lessonsLearned: (refresh?: boolean) =>
    api.get<{ findings: LessonFinding[] }>("/intelligence/lessons-learned", {
      params: refresh ? { refresh: "true" } : undefined,
    }),
};
