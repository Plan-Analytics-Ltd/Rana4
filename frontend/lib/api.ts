import axios, { type AxiosInstance, type AxiosError, type AxiosResponse } from "axios";
import { getStoredAuthToken } from "@/lib/auth-storage";
import { getInMemoryApprovalToken } from "@/lib/approval-token";

export function isAxiosError(err: unknown): err is AxiosError {
  return axios.isAxiosError(err);
}

export function getApiErrorMessage(err: unknown): string {
  if (!isAxiosError(err)) {
    return err instanceof Error && err.message ? err.message : "Something went wrong";
  }
  const data = err.response?.data;
  const status = err.response?.status;
  if (data && typeof data === "object") {
    if ("error" in data && typeof (data as { error: unknown }).error === "string")
      return (data as { error: string }).error;
    if ("message" in data && typeof (data as { message: unknown }).message === "string")
      return (data as { message: string }).message;
  }
  if (status === 403) return "You don’t have permission to perform this action.";
  if (err.code === "ERR_NETWORK" || !err.response)
    return "Cannot reach the server. Is the backend running?";
  if (status === 404) return "Not found.";
  if (status && status >= 500) return "Server error. Try again later.";
  return "Something went wrong.";
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
      const j = JSON.parse(text) as { error?: string; message?: string; code?: string };
      message = (typeof j.error === "string" && j.error) || (typeof j.message === "string" && j.message) || message;
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
  activityCode: string;
  name: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "LOCKED";
  bestDuration: number;
  likelyDuration: number;
  assuranceNoteId: string | null;
  assignedResources?: AssignedResource[];
  activityCodeAssignments?: ActivityCodeAssignmentRow[];
  createdAt: string;
};

export const activitiesApi = {
  listByFragnet: (fragnetId: string) =>
    api.get<Activity[]>(`/activities/fragnet/${fragnetId}`),
  get: (id: string) => api.get<Activity>(`/activities/${id}`),
  create: (data: {
    fragnetId: string;
    deliverableId: string;
    activityCode: string;
    name: string;
    bestDuration: number;
    likelyDuration: number;
    assuranceNoteId?: string | null;
    assignedResources?: { resourceType: string; resourceName: string; units?: number }[];
    activityCodeByTypeId?: Record<string, string | null>;
  }) => api.post<Activity>("/activities", data),
  update: (id: string, data: {
    activityCode?: string;
    name?: string;
    deliverableId?: string;
    bestDuration?: number;
    likelyDuration?: number;
    assuranceNoteId?: string | null;
    assignedResources?: { resourceType: string; resourceName: string; units?: number }[];
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
  delete: (id: string) => api.delete(`/relationships/${id}`),
};

export type Deliverable = {
  id: string;
  fragnetId: string | null;
  name: string;
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
};
