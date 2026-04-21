import axios, { type AxiosInstance, type AxiosError } from "axios";
import { getStoredAuthToken } from "@/lib/auth-storage";

export function isAxiosError(err: unknown): err is AxiosError {
  return axios.isAxiosError(err);
}

export function getApiErrorMessage(err: unknown): string {
  if (!isAxiosError(err)) return "Something went wrong";
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

export type Activity = {
  id: string;
  fragnetId: string;
  activityCode: string;
  name: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "LOCKED";
  bestDuration: number;
  likelyDuration: number;
  assuranceNoteId: string | null;
  assignedResources?: AssignedResource[];
  createdAt: string;
};

export const activitiesApi = {
  listByFragnet: (fragnetId: string) =>
    api.get<Activity[]>(`/activities/fragnet/${fragnetId}`),
  get: (id: string) => api.get<Activity>(`/activities/${id}`),
  create: (data: {
    fragnetId: string;
    activityCode: string;
    name: string;
    bestDuration: number;
    likelyDuration: number;
    assuranceNoteId?: string | null;
    assignedResources?: { resourceType: string; resourceName: string; units?: number }[];
  }) => api.post<Activity>("/activities", data),
  update: (id: string, data: {
    activityCode?: string;
    name?: string;
    bestDuration?: number;
    likelyDuration?: number;
    assuranceNoteId?: string | null;
    assignedResources?: { resourceType: string; resourceName: string; units?: number }[];
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
  }) => api.post<Deliverable>("/deliverables", { ...data, projectId: requireProjectId(data.projectId) }),
  update: (id: string, data: {
    fragnetId?: string | null;
    name?: string;
    bestDuration?: number;
    likelyDuration?: number;
    assignedResources?: { resourceType: string; resourceName: string; units?: number }[];
    externalProjectId?: string | null;
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
  /** Downloads Excel (.xlsx) with TASK, TASKPRED, TASKRSRC; adds RSRC when a rate card is uploaded. POST: scenario, projectName, projectId, optional unassignedDeliverableIds. */
  fragnet: (
    fragnetId: string,
    body: {
      scenario: "best" | "likely";
      projectName: string;
      projectId: string;
      /** IDs of unassigned (no fragnet) deliverables to include in export, one by one. */
      unassignedDeliverableIds?: string[];
    }
  ) =>
    api.post<Blob>(`/export/fragnet/${fragnetId}`, body, {
      responseType: "blob",
    }),
};
