import axios, { type AxiosInstance, type AxiosError, type AxiosResponse } from "axios";
import { getStoredAuthToken } from "@/lib/auth-storage";
import { getInMemoryApprovalToken } from "@/lib/approval-token";
import { cachedFetch, invalidateCachedFetch, SHARED_CACHE_KEYS } from "@/lib/shared-api-cache";

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

export type EngineeringBrainVersions = {
  brain: string;
  reasoningPrompt: string;
  vocabulary: string;
  validation: string;
};

export type EngineeringBrainMetrics = {
  projectsAnalysed: number;
  importsAnalysed: number;
  engineeringIdentitiesCreated: number;
  equivalentComparisons: number;
  rejectedComparisons: number;
  unknownEngineeringObjects: number;
  unknownEngineeringWork: number;
  contradictoryIdentities: number;
  validationFailures: number;
  potentialNewEngineeringObjects: number;
  potentialNewEngineeringWork: number;
  reasoningConsistency: number;
};

export type EngineeringConsistencyProbe = {
  concept: string;
  verdict: "CONSISTENT" | "INCONSISTENT";
  reason: string;
  resolvedSignatures: string[];
  variants: Array<{ name: string; signature: string; status: string }>;
};

export type EngineeringUnknownConcept = {
  concept: string;
  kind: "ENGINEERING_OBJECT" | "ENGINEERING_WORK";
  occurrences: number;
  projects: number;
  confidence: number;
  contradictions: number;
  supportingEvidence: string[];
};

export type EngineeringCandidateLearning = {
  candidate: string;
  kind: string;
  observed: number;
  projects: number;
  consistency: number;
  contradictions: number;
};

export type EngineeringReasoningDrift = {
  concept: string;
  kind: string;
  variants: Array<{ resolvedTo: string; exampleName: string; projectName: string; importedAt: string }>;
};

export type EngineeringLearningOpportunity = {
  rank: number;
  concept: string;
  seen: number;
  projects: number;
  consistency: number;
};

export type EngineeringMaturity = {
  dimensions: {
    consistency: number;
    explainability: number;
    validationSuccess: number;
    coverage: number;
    contradictionControl: number;
    repeatability: number;
    reasoningStability: number;
  };
  trust: {
    autoTrustedRate: number;
    reviewRate: number;
    developerModificationRate: number;
    developerRejectionRate: number;
    trustedAgreement: number;
  };
  overall: number;
  readiness: "NOT_READY" | "MATURING" | "READY_TO_LEARN";
  rationale: string[];
};

export type EngineeringIdentityFields = {
  discipline: string | null;
  engineeringObject: string | null;
  engineeringWork: string | null;
  deliverableType: string | null;
  lifecycleStage: string | null;
};

export type EngineeringEvidenceItem = { source: string; value: string; matched: string };

export type EngineeringComponentView = {
  id: string | null;
  label: string | null;
  confidence: number;
  evidence: EngineeringEvidenceItem[];
};

export type EngineeringIdentityView = {
  status: "RESOLVED" | "INSUFFICIENT";
  overallConfidence: number;
  discipline: EngineeringComponentView;
  engineeringObject: EngineeringComponentView;
  engineeringWork: EngineeringComponentView;
  deliverableType: EngineeringComponentView;
  lifecycleStage: EngineeringComponentView;
  projectContext: EngineeringComponentView;
  fragnetContext: EngineeringComponentView;
};

export type DeliverableContextView = {
  projectName: string;
  fragnetName: string | null;
  parentWbs: string | null;
  wbsPath: string | null;
  deliverableName: string;
  neighbouringDeliverables: string[];
  relatedActivities: string[];
  disciplineMetadata: string | null;
  classificationTags: string[];
  lifecycleStage: string | null;
};

export type InboxReasonDetail = {
  reason: string;
  detail: string;
  closestKnownObjects?: string[];
  modelConfidence?: number;
  validationRule?: string;
};

export type HistoricalMatch = {
  projectName: string;
  fragnetName: string | null;
  deliverableName: string;
  durationDays: number | null;
  matchedIdentity: { discipline: string | null; engineeringObject: string | null; engineeringWork: string | null };
  matchedComponents: string[];
  reason: string;
};

export type WhyExplanation = {
  component: string;
  conclusion: string | null;
  because: string[];
  rejectedAlternatives: string[];
};

export type DeveloperImpact = {
  deliverables: number;
  projects: number;
  futureComparisons: number;
  historicalDurationMatches: number;
};

export type GroupedExample = { projectName: string; deliverableName: string };

export type BrainInboxItem = {
  fingerprint: string;
  concept: string;
  state: "NEEDS_REVIEW" | "CONTRADICTORY";
  reasons: string[];
  reasonDetails: InboxReasonDetail[];
  exampleDeliverableName: string;
  projectName: string;
  identity: EngineeringIdentityFields;
  identityView: EngineeringIdentityView;
  context: DeliverableContextView;
  historicalMatches: HistoricalMatch[];
  why: WhyExplanation[];
  impact: DeveloperImpact;
  examples: GroupedExample[];
  evidence: string[];
  occurrences: number;
  projects: number;
  confidence: number;
};

export type TrustedKnowledgeVersionEntry = {
  at: string;
  action: string;
  status: string;
  reviewedBy: string | null;
  notes: string | null;
};

export type TrustedKnowledgeEntry = {
  fingerprint: string;
  concept: string;
  status: "AUTO_APPROVED" | "DEVELOPER_APPROVED" | "DEVELOPER_MODIFIED" | "REJECTED";
  identity: EngineeringIdentityFields;
  identityView: EngineeringIdentityView | null;
  context: DeliverableContextView | null;
  aliases: string[];
  evidence: string[];
  examples: GroupedExample[];
  historicalMatches: HistoricalMatch[];
  firstObserved: string;
  lastObserved: string;
  projectCount: number;
  successfulComparisons: number;
  versionHistory: TrustedKnowledgeVersionEntry[];
  versionHistoryCount: number;
  lastModificationReason: string | null;
};

export type EngineeringIdentityDiagnostic = {
  deliverableKey: string;
  deliverableName: string;
  projectId: string;
  projectName: string;
  importVersion: number;
  importedAt: string;
  identity: {
    discipline: string | null;
    engineeringObject: string | null;
    engineeringWork: string | null;
    deliverableType: string | null;
    lifecycleStage: string | null;
    status: string;
  };
  evidenceUsed: string[];
  reasoningResult: string;
  validationResult: { valid: boolean; contradictions: Array<{ rule: string; detail: string }> };
  confidence: number;
  reasoningDurationMs: number;
  versions: EngineeringBrainVersions;
  timestamp: string;
};

export type EngineeringReasoningEvent = {
  deliverableName: string;
  source: string;
  status: string;
  confidence: string;
  disciplineId: string | null;
  engineeringObjectId: string | null;
  engineeringWorkId: string | null;
  validationValid: boolean;
  overrides: string[];
  durationMs: number;
  at: number;
};

export type EngineeringBrainSummary = {
  brainInbox: number;
  trustedKnowledge: number;
  autoApproved: number;
  developerApproved: number;
  developerModified: number;
  rejected: number;
  totalVisible: number;
  totalIncludingRejected: number;
};

export type EngineeringBrainCollections = {
  needsReview: BrainInboxItem[];
  autoApproved: TrustedKnowledgeEntry[];
  developerApproved: TrustedKnowledgeEntry[];
  developerModified: TrustedKnowledgeEntry[];
  rejected: TrustedKnowledgeEntry[];
};

export type EngineeringBrainDiagnosticsReport = {
  generatedAt: string;
  versions: EngineeringBrainVersions;
  metrics: EngineeringBrainMetrics;
  consistency: {
    reasoningConsistency: number;
    probes: EngineeringConsistencyProbe[];
    observedConceptsAnalysed: number;
    consistentConcepts: number;
    inconsistentConcepts: number;
  };
  unknownObjects: EngineeringUnknownConcept[];
  unknownWork: EngineeringUnknownConcept[];
  candidateLearning: EngineeringCandidateLearning[];
  reasoningDrift: EngineeringReasoningDrift[];
  maturity: EngineeringMaturity;
  topOpportunities: EngineeringLearningOpportunity[];
  collections: EngineeringBrainCollections;
  summary: EngineeringBrainSummary;
  brainInbox: BrainInboxItem[];
  trustedKnowledge: TrustedKnowledgeEntry[];
  storeAvailable: boolean;
  recentReasoningEvents: EngineeringReasoningEvent[];
  sampleIdentities: EngineeringIdentityDiagnostic[];
};

export type EngineeringReviewPayload = {
  fingerprint: string;
  action: "approve" | "modify" | "reject";
  concept?: string;
  identity?: Partial<EngineeringIdentityFields>;
  aliases?: string[];
  evidence?: string[];
  notes?: string;
  observed?: { projectCount?: number; successfulComparisons?: number };
};

export type IdentityDebugExportFilters = {
  projectId?: string;
  fragnetId?: string;
  deliverableId?: string;
};

/** Versioned identity-engine debug dump — developer tooling only. */
export type IdentityDebugExport = {
  schemaVersion: string;
  generatedAt: string;
  gitCommit: string | null;
  buildVersion: string | null;
  identityEngineVersion: {
    brain: string;
    reasoningPrompt: string;
    vocabulary: string;
    validation: string;
  };
  configuration: Record<string, unknown>;
  filters: IdentityDebugExportFilters;
  storeAvailable: boolean;
  llmReasoningEnabled: boolean;
  replay: {
    supported: boolean;
    deterministic: boolean;
    missingInputs: string[];
    note: string;
  };
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    deliverableValidationFailures: number;
    brainUiParityErrors?: string[];
  };
  summary: {
    deliverableCount: number;
    projectCount: number;
    trustedCount: number;
    needsReviewCount: number;
    contradictoryCount: number;
  };
  exportSummary: {
    deliverableObservations: number;
    uniqueEngineeringIdentities: number;
    groupedObservations: number;
    brainInbox: number;
    trustedKnowledge: number;
    autoApproved: number;
    developerApproved: number;
    developerModified: number;
    rejected: number;
  };
  grouping: {
    groups: Array<{
      fingerprint: string;
      identity: {
        discipline: string | null;
        engineeringObject: string | null;
        engineeringWork: string | null;
        deliverableType: string | null;
        lifecycle: string | null;
      };
      approvalStatus: string;
      observationCount: number;
      representative: Record<string, unknown>;
      members: Record<string, unknown>[];
    }>;
  };
  brain: {
    needsReview: unknown[];
    developerModified: unknown[];
    autoApproved: unknown[];
    trustedKnowledge: unknown[];
    rejected: unknown[];
    summary: {
      total: number;
      needsReview: number;
      developerModified: number;
      autoApproved: number;
      trustedKnowledge: number;
      rejected: number;
      totalIncludingRejected: number;
    };
    ui: {
      brainInbox: number;
      trustedKnowledge: number;
      totalVisible: number;
    };
    source: string;
    uiParity: boolean;
  };
  data: { deliverables: unknown[] };
};

export const devApi = {
  listAdminRequests: () => api.get<{ requests: DevAdminRequestRow[] }>("/dev/admin-requests"),
  engineeringBrain: () => api.get<EngineeringBrainDiagnosticsReport>("/dev/engineering-brain"),
  reviewEngineeringIdentity: (payload: EngineeringReviewPayload) =>
    api.post<{ entry: TrustedKnowledgeEntry }>("/dev/engineering-brain/review", payload),
  /**
   * Full identity-resolution pipeline dump. Completeness over size — may be large.
   * Gated by requireDevEmail on the server.
   */
  exportIdentityReviewDebug: (filters: IdentityDebugExportFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.projectId) params.set("projectId", filters.projectId);
    if (filters.fragnetId) params.set("fragnetId", filters.fragnetId);
    if (filters.deliverableId) params.set("deliverableId", filters.deliverableId);
    const qs = params.toString();
    return api.get<IdentityDebugExport>(`/api/debug/identity-review${qs ? `?${qs}` : ""}`, {
      timeout: 120_000,
    });
  },
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

export type DetectionConfidence = "high" | "medium" | "low" | "none";

export type DetectionSourceKind =
  | "project_metadata"
  | "project_properties"
  | "wbs"
  | "activity_names"
  | "activity_descriptions"
  | "activity_codes"
  | "calendars"
  | "resources"
  | "filename";

export type SourceSearchResult = {
  kind: DetectionSourceKind;
  label: string;
  searched: boolean;
  itemCount: number;
};

export type KeywordHit = {
  pattern: string;
  count: number;
  source: DetectionSourceKind;
};

export type KeywordMatchEvidence = {
  label: string;
  score: number;
  hits: number;
  matchedKeywords: KeywordHit[];
  sources: DetectionSourceKind[];
};

export type FieldTrace = {
  sourcesSearched: SourceSearchResult[];
  matchedKeywords?: KeywordMatchEvidence[];
  rejectedMatches?: KeywordMatchEvidence[];
  ignoredMatches?: KeywordMatchEvidence[];
  conflictResolution?: string;
  confidenceReasoning: string;
  evidenceSummary: string[];
  rawSignals?: Record<string, unknown>;
};

export type ComplexityDetail = {
  score: number;
  maxScore: number;
  band: string;
  factors: { name: string; value: number | string; contribution: number; maxContribution: number }[];
};

export type DetectedField = {
  value: string | null;
  confidence: DetectionConfidence;
  reason: string;
  source: string;
  needsConfirmation: boolean;
  trace?: FieldTrace;
};

export type ProjectDetectionReadiness = {
  ready: boolean;
  summary: string;
  missingFields: string[];
};

export type ProjectDetectionResult = {
  projectName: DetectedField;
  clientType: DetectedField;
  projectType: DetectedField;
  stage: DetectedField;
  complexity: DetectedField & { complexityDetail?: ComplexityDetail };
  readiness: ProjectDetectionReadiness;
  detectionTimeMs?: number;
};

export type XerProjectPreview = {
  valid: boolean;
  errors: { severity: "error" | "warning"; message: string }[];
  warnings: { severity: "error" | "warning"; message: string }[];
  projectName: string;
  programmeName: string;
  primaveraProjectId: string | null;
  wbsCount: number;
  activityCount: number;
  relationshipCount: number;
  calendarCount: number;
  resourceCount: number;
  projectStart: string | null;
  projectFinish: string | null;
  suggestedProjectName: string;
  duplicateProjectName: boolean;
  detection: ProjectDetectionResult | null;
};

export type XerProjectImportResult = {
  projectId: string;
  projectName: string;
  baselineSnapshotId: string;
  created: {
    standards: number;
    fragnets: number;
    deliverables: number;
    activities: number;
    relationships: number;
  };
  skippedRelationships: number;
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

export type ProjectDashboardSummary = {
  deliverablesCount: number;
  activitiesCount: number;
  deliverablesMissingDuration: number;
  lastImport: {
    importedAt: string;
    sourceType: string;
    label: string | null;
  } | null;
};

export const projectsApi = {
  listMine: () => api.get<Project[]>("/projects"),
  create: (data: { name: string }) => api.post<Project>("/projects", data),
  previewFromXer: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<XerProjectPreview>("/projects/from-xer/preview", form);
  },
  createFromXer: (
    file: File,
    details: {
      name: string;
      clientType?: string;
      projectType?: string;
      stage?: string;
      complexity?: string;
      description?: string;
    }
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("name", details.name);
    if (details.clientType) form.append("clientType", details.clientType);
    if (details.projectType) form.append("projectType", details.projectType);
    if (details.stage) form.append("stage", details.stage);
    if (details.complexity) form.append("complexity", details.complexity);
    if (details.description) form.append("description", details.description);
    return api.post<XerProjectImportResult>("/projects/from-xer", form);
  },
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
  getDashboardSummary: (projectId: string) =>
    api.get<ProjectDashboardSummary>(`/projects/${encodeURIComponent(projectId)}/dashboard-summary`),
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

export type IntelligenceTrustExplanation = {
  trustScore: number;
  trustBand: string;
  trustLabel: string;
  evidenceStrength: {
    strengthLabel: string;
    sampleSize: number;
    projectCount: number;
    benchmarkConfidence: string | null;
    benchmarkConfidenceScore: number | null;
    layersAvailable: string[];
  };
  knowledgeCoverage: {
    coverageLabel: string;
    coverageScore: number;
    sampleSize: number;
    projectCount: number;
    learningMaturity: string | null;
    hasReliabilityEvidence: boolean;
    hasOutcomePrediction: boolean;
  };
  recommendationTraceability: {
    traceChain: string[];
    sourceLayers: Array<{
      layer: string;
      status: string;
      evidenceCount: number;
      summary: string;
    }>;
    recommendationCount: number;
    recommendations: Array<{
      type: string;
      title: string;
      evidenceCount: number;
      sourceLayers: string[];
    }>;
  };
  whySeeingThis: string[];
  supportingEvidence: { label: string; value: string | number }[];
};

export type IntelligenceTrustProfile = IntelligenceTrustExplanation & {
  id: string;
  classification: string;
  label: string;
  lastUpdated: string;
};

export type IntelligenceRecommendation = {
  recommendationType: string;
  title: string;
  summary: string;
  recommendation: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  confidenceScore: number;
  evidenceCount: number;
  supportingEvidence: { label: string; value: string | number }[];
};

export type RecommendationTrendGroup = {
  recommendationType: string;
  typeLabel: string;
  description: string;
  profiles: RecommendationProfile[];
};

export type RecommendationProfile = {
  id: string;
  classification: string;
  label: string;
  recommendationType: string;
  title: string;
  summary: string;
  recommendation: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  confidenceScore: number;
  evidenceCount: number;
  supportingEvidence: { label: string; value: string | number }[];
  lastUpdated: string;
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

export type BenchmarkExpectedDuration = {
  rangeLabel: string | null;
  minimumExpectedDays: number | null;
  mostLikelyDays: number | null;
  maximumExpectedDays: number | null;
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  confidenceScore: number;
  evidenceCount: number;
  learningMaturity?: string;
  maturityLabel?: string;
  evidenceVolume?: number;
  coverageScore?: number;
  explanation?: string[];
};

export type BenchmarkForecastReliability = {
  reliabilityLabel: string;
  reliabilityBand: string;
  overrunFrequency: number;
  underrunFrequency?: number;
  onTargetFrequency?: number;
  averageVariancePercent: number | null;
  averageVarianceDays?: number | null;
  sampleSize: number;
  confidenceLevel: string;
  confidenceScore: number;
};

export type BenchmarkPredictedOutcome = {
  rangeLabel: string | null;
  predictedMinimumDuration: number | null;
  predictedMostLikelyDuration: number | null;
  predictedMaximumDuration: number | null;
  predictionConfidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  predictionConfidenceScore: number;
  evidenceCount: number;
  reasoning: string[];
};

export type BenchmarkOutlierStatus =
  | "NORMAL"
  | "SLIGHTLY_LOW"
  | "WELL_BELOW"
  | "SLIGHTLY_HIGH"
  | "HIGH"
  | "RED_FLAG"
  | "EXTREME_OUTLIER";

export type DurationPosition =
  | "WELL_BELOW"
  | "SLIGHTLY_BELOW"
  | "TYPICAL"
  | "SLIGHTLY_ABOVE"
  | "WELL_ABOVE";

export type BenchmarkOutlier = {
  status: BenchmarkOutlierStatus;
  rawStatus?: BenchmarkOutlierStatus;
  position?: DurationPosition;
  rawPosition?: DurationPosition;
  effectivePosition?: DurationPosition;
  positionLabel?: string;
  rawPositionLabel?: string;
  effectivePositionLabel?: string;
  percentilePosition?: number | null;
  currentDurationDays: number | null;
  differenceFromAveragePercent: number | null;
  differenceFromMedianPercent?: number | null;
};

export type MatchedDeliverableEvidence = {
  projectId: string;
  projectName: string;
  deliverableId: string;
  deliverableName: string;
  classification: string;
  programmeState: string;
  durationDays: number;
  similarityScore: number;
  similaritySignals?: Record<string, number>;
};

export type BenchmarkEvidence = {
  sampleSize: number;
  matchedDeliverables: MatchedDeliverableEvidence[];
};

export type DeliverableBenchmarkBlock = {
  averageDuration: number | null;
  medianDuration: number | null;
  percentile25?: number | null;
  percentile75?: number | null;
  interquartileRange?: number | null;
  minimumDuration: number | null;
  maximumDuration: number | null;
  sampleSize: number;
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH" | null;
  confidenceScore: number | null;
  sampleSizeConfidenceTier?: string | null;
  notes?: string[];
  expectedDuration: BenchmarkExpectedDuration | null;
  forecastReliability: BenchmarkForecastReliability | null;
  predictedOutcome: BenchmarkPredictedOutcome | null;
  benchmarkQuality?: {
    averageProjectSimilarity: number | null;
    distinctProjects?: number;
    distinctSnapshots?: number;
    revisionRatio?: number;
  };
};

export type CurrentDurationSource = {
  source: string;
  sourceTable: string;
  sourceFields: string[];
  definition: string;
};

export type BaselineDurationSource = {
  durationDays: number | null;
  snapshotId: string | null;
  snapshotLabel: string | null;
  definition: string;
};

export type DeliverableDurationView = {
  current: CurrentDurationSource & { durationDays: number | null };
  baseline: BaselineDurationSource;
};

export type IntelligenceConsistencyReport = {
  consistent: boolean;
  warnings: Array<{ code: string; message: string; layers: string[] }>;
  unifiedPosition: DurationPosition | null;
  unifiedPositionLabel: string | null;
};

export type DeliverableAnalysisCore = {
  deliverable: { id: string; name: string; classification: string | null };
  currentDurationDays: number | null;
  currentDurationSource?: CurrentDurationSource;
  durationView?: DeliverableDurationView;
  benchmark: DeliverableBenchmarkBlock;
  outlier: BenchmarkOutlier;
  evidence: BenchmarkEvidence;
};

export type DurationStatisticsEntry = {
  projectName: string;
  deliverableName: string;
  durationDays: number;
};

export type DurationStatistics = {
  available: boolean;
  projectsUsed: number;
  sampleCount: number;
  minimumDays: number | null;
  averageDays: number | null;
  maximumDays: number | null;
  entries: DurationStatisticsEntry[];
};

export type DeliverableIntelligenceAnalysis = DeliverableAnalysisCore & {
  observations: IntelligenceFinding[];
  keyFactors: IntelligenceDriver[];
  reliability: BenchmarkForecastReliability | null;
  predictedOutcome: BenchmarkPredictedOutcome | null;
  recommendations: IntelligenceRecommendation[];
  trust: IntelligenceTrustExplanation;
  consistency?: IntelligenceConsistencyReport;
  durationStatistics?: DurationStatistics;
};

export type IntelligenceDashboard = {
  insights: LearnedInsight[];
  deliverableProfiles: DeliverableKnowledgeProfile[];
  reliabilityProfiles: DeliverableReliabilityProfile[];
  outcomeProfiles: DeliverableOutcomeProfile[];
  recommendationProfiles: RecommendationProfile[];
  recommendationTrends: RecommendationTrendGroup[];
  trustProfiles: IntelligenceTrustProfile[];
};

export const EXPLANATION_TYPES = [
  "FLAGGED_DELIVERABLE",
  "RECOMMENDATION",
  "PREDICTED_OUTCOME",
  "BENCHMARK",
  "FORECAST_RELIABILITY",
  "TRUST_SCORE",
  "KEY_FACTORS",
  "DELIVERABLE_SUMMARY",
] as const;

export type ExplanationType = (typeof EXPLANATION_TYPES)[number];

export type ExplanationCitation = {
  id: string;
  layer: string;
  label: string;
  summary: string;
  evidenceCount?: number | null;
  confidenceLevel?: string | null;
  confidenceScore?: number | null;
};

export type ExplanationSource = {
  layer: string;
  reference: string;
  detail?: string;
};

export type ExplanationContextSummary = {
  deliverableId: string;
  deliverableName: string;
  classification: string | null;
  currentDurationDays: number | null;
  outlierStatus: string | null;
  benchmarkSampleSize: number;
  observationCount: number;
  keyFactorCount: number;
  recommendationCount: number;
  trustBand: string | null;
  trustScore: number | null;
  hasForecastReliability: boolean;
  hasPredictedOutcome: boolean;
};

export type ExplanationReadiness = "READY" | "LIMITED" | "NOT_READY";

export type ValidationCheck = {
  id: string;
  label: string;
  result: "PASS" | "WARNING" | "FAIL";
  message: string;
};

export type ExplanationValidationReport = {
  readiness: ExplanationReadiness;
  score: number;
  issues: string[];
  passedChecks: ValidationCheck[];
  warningChecks: ValidationCheck[];
  failedChecks: ValidationCheck[];
};

export type DeliverableExplanationResult = {
  status: "success" | "provider_not_configured" | "mock" | "disabled" | "not_ready" | "error";
  explanationType: ExplanationType;
  question: string | null;
  explanation: string | null;
  confidence: string | null;
  citations: ExplanationCitation[];
  sources: ExplanationSource[];
  supportingEvidence: { label: string; value: string | number }[];
  generatedPrompt: { system: string; user: string };
  contextSummary: ExplanationContextSummary;
  validation: ExplanationValidationReport;
  providerCalled: boolean;
  message?: string;
  providerId?: string;
};

export type DeliverableExplanationValidationResult = {
  validation: ExplanationValidationReport;
  contextSummary: ExplanationContextSummary;
};

export const EXPLANATION_TYPE_LABELS: Record<ExplanationType, string> = {
  FLAGGED_DELIVERABLE: "Why is this flagged?",
  RECOMMENDATION: "Explain recommendations",
  PREDICTED_OUTCOME: "Explain predicted outcome",
  BENCHMARK: "Explain benchmark",
  FORECAST_RELIABILITY: "Explain forecast reliability",
  TRUST_SCORE: "Explain trust score",
  KEY_FACTORS: "Explain key factors",
  DELIVERABLE_SUMMARY: "Summarise deliverable",
};

export type AskRanaConversationTurn = {
  role: "planner" | "rana";
  content: string;
};

export type AskRanaResult = {
  status: "success" | "disabled" | "error" | "not_ready" | "provider_not_configured" | "mock";
  answer: string | null;
  message?: string;
  sources: string[];
  providerCalled: boolean;
  providerId?: string;
  loadingHint?: string;
  evidenceDomains?: string[];
};

export const intelligenceApi = {
  getDeliverableIntelligenceAnalysis: (
    projectId: string,
    deliverableId: string,
    opts?: { projectIds?: string[] }
  ) => {
    const pid = requireProjectId(projectId);
    const projectIds = (opts?.projectIds ?? []).filter(Boolean);
    return api.get<DeliverableIntelligenceAnalysis>(
      `/projects/${encodeURIComponent(pid)}/intelligence/analysis/${encodeURIComponent(deliverableId)}`,
      {
        params: projectIds.length ? { projectIds: projectIds.join(",") } : undefined,
      }
    );
  },
  explainDeliverable: (
    projectId: string,
    body: {
      deliverableId: string;
      explanationType: ExplanationType;
      question?: string | null;
      projectIds?: string[];
    }
  ) => {
    const pid = requireProjectId(projectId);
    return api.post<DeliverableExplanationResult>(
      `/projects/${encodeURIComponent(pid)}/intelligence/explain`,
      body
    );
  },
  askRana: (
    projectId: string,
    body: {
      deliverableId?: string;
      question: string;
      conversation?: AskRanaConversationTurn[];
      projectIds?: string[];
      pageContext?: string;
    }
  ) => {
    const pid = requireProjectId(projectId);
    return api.post<AskRanaResult>(
      `/projects/${encodeURIComponent(pid)}/intelligence/ask-rana`,
      body
    );
  },
  validateDeliverableExplanation: (
    projectId: string,
    body: {
      deliverableId: string;
      explanationType: ExplanationType;
      projectIds?: string[];
    }
  ) => {
    const pid = requireProjectId(projectId);
    return api.post<DeliverableExplanationValidationResult>(
      `/projects/${encodeURIComponent(pid)}/intelligence/explain/validate`,
      body
    );
  },
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
  getDeliverableTrust: (projectId: string, deliverableId: string, opts?: { projectIds?: string[] }) => {
    const pid = requireProjectId(projectId);
    const projectIds = (opts?.projectIds ?? []).filter(Boolean);
    return api.get<{ trust: IntelligenceTrustExplanation }>(
      `/projects/${encodeURIComponent(pid)}/intelligence/trust/${encodeURIComponent(deliverableId)}`,
      {
        params: projectIds.length ? { projectIds: projectIds.join(",") } : undefined,
      }
    );
  },
  getDeliverableRecommendations: (projectId: string, deliverableId: string, opts?: { projectIds?: string[] }) => {
    const pid = requireProjectId(projectId);
    const projectIds = (opts?.projectIds ?? []).filter(Boolean);
    return api.get<{ recommendations: IntelligenceRecommendation[] }>(
      `/projects/${encodeURIComponent(pid)}/intelligence/recommendations/${encodeURIComponent(deliverableId)}`,
      {
        params: projectIds.length ? { projectIds: projectIds.join(",") } : undefined,
      }
    );
  },
  getProfile: (projectId: string) => {
    const pid = requireProjectId(projectId);
    return api.get<{ profile: ProjectIntelligenceProfile }>(
      `/projects/${encodeURIComponent(pid)}/intelligence/profile`
    );
  },
  similarProjects: (projectId: string, opts?: { limit?: number }) => {
    const pid = requireProjectId(projectId);
    return api.get<SimilarProjectsReport>(
      `/projects/${encodeURIComponent(pid)}/intelligence/similar-projects`,
      { params: opts?.limit != null ? { limit: opts.limit } : undefined }
    );
  },
  programmeReview: (projectId: string) => {
    const pid = requireProjectId(projectId);
    return api.get<ProgrammeReviewPresentation>(
      `/projects/${encodeURIComponent(pid)}/intelligence/programme-review`
    );
  },
  projectIntelligence: (projectId: string) => {
    const pid = requireProjectId(projectId);
    return api.get<ProjectIntelligence>(
      `/projects/${encodeURIComponent(pid)}/project-intelligence`
    );
  },
  getDeliverableProjectEvolution: (projectId: string, deliverableId: string) => {
    const pid = requireProjectId(projectId);
    return api.get<DeliverableProjectEvolutionReport>(
      `/projects/${encodeURIComponent(pid)}/intelligence/project-evolution/${encodeURIComponent(deliverableId)}`
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

type RateCardResponse = {
  entries: RateCardEntry[];
  types: string[];
  summary: { type: string; count: number }[];
};

export const rateCardApi = {
  get: async () => {
    const data = await cachedFetch(SHARED_CACHE_KEYS.rateCard, async () => {
      const res = await api.get<RateCardResponse>("/rate-card");
      return res.data;
    });
    return { data };
  },
  /** Replaces the entire rate card. Field name must be `file`. */
  upload: async (file: File, projectId?: string) => {
    const body = new FormData();
    body.append("file", file);
    const res = await api.post<{ ok: boolean; count: number; message: string }>("/rate-card/upload", body, {
      params: { projectId: requireProjectId(projectId) },
    });
    invalidateCachedFetch(SHARED_CACHE_KEYS.rateCard);
    return res;
  },
  /** Deletes every rate card row in the database. */
  clear: async (projectId?: string) => {
    const res = await api.delete<{ ok: boolean; message: string }>("/rate-card", {
      params: { projectId: requireProjectId(projectId) },
    });
    invalidateCachedFetch(SHARED_CACHE_KEYS.rateCard);
    return res;
  },
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
  list: async (projectId?: string) => {
    const pid = requireProjectId(projectId);
    const data = await cachedFetch(SHARED_CACHE_KEYS.activityCodeTypes(pid), async () => {
      const res = await api.get<ActivityCodeType[]>("/activity-code-types", { params: { projectId: pid } });
      return res.data;
    });
    return { data };
  },
  create: async (data: { projectId?: string; name: string; slug?: string; shortName?: string | null; seqNum?: number }) => {
    const pid = requireProjectId(data.projectId);
    const res = await api.post<ActivityCodeType>("/activity-code-types", { ...data, projectId: pid });
    invalidateCachedFetch(SHARED_CACHE_KEYS.activityCodeTypes(pid));
    return res;
  },
  update: async (
    id: string,
    data: { projectId?: string; name?: string; slug?: string; shortName?: string | null; seqNum?: number }
  ) => {
    const pid = requireProjectId(data.projectId);
    const res = await api.put<ActivityCodeType>(`/activity-code-types/${encodeURIComponent(id)}`, {
      ...data,
      projectId: pid,
    });
    invalidateCachedFetch(SHARED_CACHE_KEYS.activityCodeTypes(pid));
    return res;
  },
  delete: async (id: string, projectId?: string) => {
    const pid = requireProjectId(projectId);
    const res = await api.delete(`/activity-code-types/${encodeURIComponent(id)}`, { params: { projectId: pid } });
    invalidateCachedFetch(SHARED_CACHE_KEYS.activityCodeTypes(pid));
    return res;
  },
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

export type DeliverableDurationStatistics = {
  available: boolean;
  projectsUsed: number;
  sampleCount: number;
  minimumDays: number | null;
  averageDays: number | null;
  maximumDays: number | null;
};

export type DeliverableDurationStatisticsItem = {
  key: string;
  deliverableId: string | null;
  name: string;
  matchMode: "FULL_DELIVERABLE_CONTEXT" | "NAME_ONLY";
  provisional: boolean;
  statistics: DeliverableDurationStatistics;
  comparisonBasis: "SAME_FRAGNET" | "SAME_DISCIPLINE" | "ORGANISATION_WIDE" | null;
  contributingProjects: Array<{
    projectId: string;
    projectName: string;
    matchedDeliverableName: string;
    fragnetName: string | null;
    planningDurationDays: number;
  }>;
  projectDiagnostics: Array<{
    projectId: string;
    projectName: string;
    used: boolean;
    reason:
      | "USED"
      | "NO_EQUIVALENT_DELIVERABLE"
      | "NO_PLANNING_DURATION"
      | "CLOSER_COMPARISON_AVAILABLE";
  }>;
  unavailableReason: string | null;
};

export type DeliverableDurationStatisticsResponse = {
  projectId: string;
  durationDefinition: {
    measure: "HISTORICAL_PLANNED_WORK_PACKAGE_DURATION";
    aggregation: "MAX_ACTIVITY_ORIGINAL_DURATION";
    source: "ACTIVITY_SNAPSHOT_ORIGINAL_DURATION";
    liveFallbackSource: "CURRENT_BEST_PLANNING_DURATION_NORMALISED_FROM_P6_HOURS";
    unit: "PLANNING_DAYS";
    fallbacksPossible: false;
  };
  items: DeliverableDurationStatisticsItem[];
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
  durationStatistics: (
    projectId: string | undefined,
    targets?: Array<{ key: string; deliverableId?: string; name?: string }>
  ) =>
    api.post<DeliverableDurationStatisticsResponse>("/deliverables/duration-statistics/query", {
      projectId: requireProjectId(projectId),
      ...(targets ? { targets } : {}),
    }),
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

export type AuditLogSummaryItem = {
  id: string;
  createdAt: string;
  actorDisplayName: string;
  actionPhrase: string;
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
  listSummary: (params?: { projectId?: string; limit?: number; cursor?: string | null }) =>
    api.get<{ items: AuditLogSummaryItem[]; nextCursor: string | null }>("/audit-logs", {
      params: {
        projectId: requireProjectId(params?.projectId),
        limit: params?.limit,
        cursor: params?.cursor ?? undefined,
        view: "summary",
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
  programmeDisplayName: string | null;
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
  findingType?: string;
  category?: string;
};

export type ProjectIntelligenceProfile = {
  projectId: string;
  sector: string | null;
  projectType: string | null;
  procurementRoute: string | null;
  stage: string | null;
  region: string | null;
  clientType: string | null;
  complexity: string | null;
  classificationTagsList: string[];
  disciplineTags: string[];
};

export type SimilarProjectMatch = {
  projectId: string;
  projectName: string;
  similarityScore: number;
  confidenceScore: number;
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  matchedFields: string[];
  explanations: string[];
};

export type SimilarProjectsReport = {
  matches: SimilarProjectMatch[];
  confidence: number;
  explanations: string[];
};

export type DeliverableProjectEvolutionRevision = {
  snapshotId: string;
  label: string;
  programmeDisplayName: string | null;
  role: string | null;
  programmeState: string | null;
  importedAt: string;
  /** Programme remaining (primary evolution metric). */
  durationDays: number | null;
  durationChangeDays: number | null;
  remainingDurationDays: number | null;
  remainingDurationChangeDays: number | null;
  planningDurationDays: number | null;
  planningDurationChangeDays: number | null;
  planningChanged: boolean;
  changeKind: "stable" | "progress" | "remaining_increase" | "replanning" | null;
};

export type ProgrammeLogicEvent = {
  type: string;
  activityCode: string;
  activityName: string | null;
  description: string;
  storyBullet?: string | null;
  predecessorCode?: string;
  relationshipType?: string;
  lagDays?: number;
};

export type RevisionProgrammeIntelligence = {
  revisionIndex: number;
  revisionLabel: string;
  snapshotId: string;
  durationDays: number | null;
  durationChangeDays: number | null;
  relationshipCount: number;
  relationshipCountChange: number | null;
  relationshipDensity: number | null;
  events: ProgrammeLogicEvent[];
  plannerObservations: string[];
  storyBullets: string[];
  hasMeaningfulChanges: boolean;
};

export type ProjectEvolutionDurationChangeStep = {
  revisionIndex: number;
  revisionLabel: string;
  changeDays: number;
  fromDays: number;
  toDays: number;
};

export type ProjectEvolutionStablePeriod = {
  startRevisionIndex: number;
  endRevisionIndex: number;
  startLabel: string;
  endLabel: string;
  durationDays: number;
  revisionCount: number;
};

export type ProjectEvolutionRevisionHighlight = {
  revisionIndex: number;
  revisionLabel: string;
  role: string | null;
  durationDays: number;
  durationChangeDays: number | null;
  highlightReason: string;
};

export type ProjectEvolutionMajorEvent = {
  type: string;
  revisionIndex: number;
  revisionLabel: string;
  description: string;
};

export type ProjectEvolutionIntelligence = {
  summary: string;
  revisionCount: number;
  baseline: number | null;
  latest: number | null;
  peak: number | null;
  minimum: number | null;
  netChange: number | null;
  trend: string;
  volatility: "LOW" | "MODERATE" | "HIGH" | null;
  changePattern: "STABLE" | "GRADUAL" | "SUDDEN" | "OSCILLATING" | "MIXED" | null;
  changePace: "MOSTLY_INCREASED" | "MOSTLY_DECREASED" | "MOSTLY_STABLE" | "MIXED" | null;
  largestIncrease: ProjectEvolutionDurationChangeStep | null;
  largestReduction: ProjectEvolutionDurationChangeStep | null;
  largestSingleRevisionChange: ProjectEvolutionDurationChangeStep | null;
  firstMeaningfulChange: ProjectEvolutionDurationChangeStep | null;
  latestMeaningfulChange: ProjectEvolutionDurationChangeStep | null;
  stablePeriods: ProjectEvolutionStablePeriod[];
  longestStablePeriod: ProjectEvolutionStablePeriod | null;
  revisionHighlights: ProjectEvolutionRevisionHighlight[];
  majorEvents: ProjectEvolutionMajorEvent[];
  timelineHighlights: string[];
  plannerObservations: string[];
  howChangedSummary: string | null;
};

export type DeliverableProjectEvolutionReport = {
  deliverableId: string;
  deliverableName: string;
  programmeDisplayName: string | null;
  revisions: DeliverableProjectEvolutionRevision[];
  evolution: {
    initialDuration: number | null;
    maximumDuration: number | null;
    finalDuration: number | null;
    growthPercent: number | null;
    reductionPercent: number | null;
    revisionCount: number;
    largestChangeDays: number | null;
    trend: string;
  };
  timeline: {
    typicalBaselineDuration: number | null;
    typicalPeakDuration: number | null;
    typicalCompletedDuration: number | null;
    averageGrowthPercent: number | null;
    averageReductionPercent: number | null;
    averageRevisionCount: number;
    mostCommonRevisionStage: string | null;
    largestHistoricalIncrease: number | null;
    evolutionSummary: string | null;
  };
  projectEvolutionIntelligence: ProjectEvolutionIntelligence;
  programmeLogicEvolution: RevisionProgrammeIntelligence[];
  programmeLogicSummary: string | null;
  durationView: DeliverableDurationView;
};

export type OrganisationalPatternType =
  | "REPEATED_SCOPE_GROWTH"
  | "REPEATED_DURATION_REDUCTION"
  | "REPEATED_PROLONGED_COMPLETION"
  | "HIGH_REVISION_VOLATILITY"
  | "FREQUENT_UNDERESTIMATION";

export type OrganisationalPattern = {
  type: OrganisationalPatternType;
  label: string;
  summary: string;
  deliverableName: string;
  classification: string | null;
  projectCount: number;
  occurrenceCount: number;
};

export type OrganisationKnowledgeEntry = {
  id: string;
  category: string;
  label: string;
  summary: string;
  metric?: number | null;
  deliverableName?: string | null;
  classification?: string | null;
};

export type OrganisationKnowledgeReport = {
  entries: OrganisationKnowledgeEntry[];
  patterns: OrganisationalPattern[];
  projectCount: number;
  deliverableCount: number;
  revisionCount: number;
};

export type ProgrammeRevisionOption = {
  value: string;
  label: string;
  snapshotRole: string | null;
  importedAt: string | null;
  isLatestLiveUpdate?: boolean;
};

export type RevisionDeliverableDurations = {
  deliverableId: string;
  bestDuration: number;
  likelyDuration: number;
};

export const programmeIntelligenceApi = {
  listSnapshots: (projectId: string) =>
    api.get<{ snapshots: ProgrammeSnapshotSummary[] }>(
      `/projects/${encodeURIComponent(projectId)}/programme-snapshots`
    ),
  listProgrammeRevisions: (projectId: string) =>
    api.get<{ revisions: ProgrammeRevisionOption[] }>(
      `/projects/${encodeURIComponent(projectId)}/programme-revisions`
    ),
  getRevisionDeliverableDurations: (projectId: string, snapshotId: string) =>
    api.get<{ durations: RevisionDeliverableDurations[] }>(
      `/projects/${encodeURIComponent(projectId)}/programme-revisions/${encodeURIComponent(snapshotId)}/deliverable-durations`
    ),
  getLiveDeliverableDurations: (projectId: string) =>
    api.get<{ durations: RevisionDeliverableDurations[] }>(
      `/projects/${encodeURIComponent(projectId)}/programme-revisions/live/deliverable-durations`
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

export type LearnedInsightType =
  | "DURATION_OVERRUN"
  | "DURATION_PREDICTABILITY"
  | "FLOAT_CONSUMPTION"
  | "DRIVER_STRENGTH"
  | "RECURRING_LESSON"
  | "FORECAST_RELIABILITY"
  | "OUTCOME_PREDICTION";

export type LearnedInsight = {
  id: string;
  insightType: LearnedInsightType;
  title: string;
  summary: string;
  observation: string;
  category: string | null;
  classification: string | null;
  projectType: string | null;
  stage: string | null;
  complexity: string | null;
  clientType: string | null;
  procurementRoute: string | null;
  sampleSize: number;
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  confidenceScore: number;
  evidenceJson: Record<string, unknown>;
  lastCalculatedAt: string;
};

export type DeliverableReliabilityProfile = {
  id: string;
  classification: string;
  label: string;
  sampleSize: number;
  projectCount: number;
  plannedAverageDuration: number | null;
  actualAverageDuration: number | null;
  averageVariancePercent: number | null;
  averageVarianceDays: number | null;
  overrunFrequency: number;
  underrunFrequency: number;
  onTargetFrequency: number;
  predictabilityScore: number | null;
  reliabilityScore: number;
  reliabilityBand: string;
  reliabilityLabel: string;
  confidenceLevel: string;
  confidenceScore: number;
  lastUpdated: string;
};

export type DeliverableOutcomeProfile = {
  id: string;
  classification: string;
  label: string;
  sampleSize: number;
  projectCount: number;
  predictedMinimumDuration: number | null;
  predictedMostLikelyDuration: number | null;
  predictedMaximumDuration: number | null;
  rangeLabel: string | null;
  historicalAverageDuration: number | null;
  historicalMedianDuration: number | null;
  historicalOverrunFrequency: number;
  historicalAverageVariancePercent: number | null;
  predictionConfidenceLevel: string;
  predictionConfidenceScore: number;
  reasoning: string[];
  lastUpdated: string;
};

export type DeliverableKnowledgeProfile = {
  id: string;
  classification: string;
  label: string;
  sampleSize: number;
  projectCount: number;
  averageDuration: number | null;
  medianDuration: number | null;
  minimumDuration: number | null;
  maximumDuration: number | null;
  standardDeviation: number | null;
  predictabilityScore: number | null;
  confidenceScore: number;
  confidenceLevel: string;
  learningMaturity: string;
  maturityLabel: string;
  evidenceVolume: number;
  coverageScore: number | null;
  lastCalculatedAt: string;
};

export type DeliverableVariantTrace = {
  originalName: string;
  observationCount: number;
};

export type WorkPackageMemoryItem = {
  key: string;
  disciplineId: string;
  disciplineLabel: string;
  categoryId: string;
  categoryLabel: string;
  workPackageId: string;
  workPackageLabel: string;
  typicalDurationDays: number | null;
  durationVariationDays: number | null;
  sampleSize: number;
  projectCount: number;
  projectNames: string[];
  confidenceExplanation: string[];
  limitedEvidenceReason: string | null;
  confidenceTier: "high" | "moderate" | "limited";
  compactSummary: string;
  deliverableVariants: DeliverableVariantTrace[];
  sourceDeliverableNames: string[];
  classification: string | null;
  isUnclassified: boolean;
  /** @deprecated Use workPackageId */
  engineeringActivityId?: string;
  /** @deprecated Use workPackageLabel */
  engineeringActivityLabel?: string;
};

/** @deprecated Use WorkPackageMemoryItem */
export type EngineeringActivityMemoryItem = WorkPackageMemoryItem;

export type CategoryMemorySection = {
  categoryId: string;
  categoryLabel: string;
  workPackageCount: number;
  workPackages: WorkPackageMemoryItem[];
};

export type DisciplineMemorySection = {
  disciplineId: string;
  disciplineLabel: string;
  workPackageCount: number;
  categories: CategoryMemorySection[];
  workPackages: WorkPackageMemoryItem[];
  /** @deprecated Use workPackages */
  activities?: WorkPackageMemoryItem[];
};

export type WorkPackageMemoryLegacyItem = WorkPackageMemoryItem & {
  name: string;
  sectionTitle: string;
};

export type OrganisationalMemoryPresentation = {
  summary: {
    completedProjectCount: number;
    programmesIndexed: number;
    workPackagesIndexed: number;
    canonicalWorkPackagesIndexed: number;
    /** @deprecated Use canonicalWorkPackagesIndexed */
    engineeringActivitiesIndexed?: number;
    deliverableObservationsIndexed: number;
    lastUpdated: string | null;
  };
  disciplines: DisciplineMemorySection[];
  sections: Array<{ title: string; workPackages: WorkPackageMemoryLegacyItem[] }>;
  unclassified: {
    workPackageCount: number;
    examples: string[];
    recommendation: string;
    workPackages: WorkPackageMemoryItem[];
  } | null;
  wellSupported: WorkPackageMemoryItem[];
  limitedEvidence: WorkPackageMemoryItem[];
  singleProjectOnly: WorkPackageMemoryItem[];
};

export type WorkPackageBrief = {
  key: string;
  name: string;
  sectionTitle: string;
  disciplineLabel: string;
  categoryLabel?: string;
  workPackageLabel: string;
  /** @deprecated Use workPackageLabel */
  engineeringActivityLabel: string;
  typicalDurationDays: number | null;
  durationVariationDays: number | null;
  projectCount: number;
  sampleSize: number;
  projectNames: string[];
  confidenceExplanation: string[];
  why: string | null;
  typicalRisks: string[];
  planningRecommendations: string[];
  contributingProjects: string[];
  deliverableVariants: DeliverableVariantTrace[];
  sourceDeliverableNames: string[];
};

export type ProgrammeReviewItem = {
  deliverableId: string;
  deliverableName: string;
  workPackageKey: string;
  taxonomyKey: string | null;
  disciplineLabel: string | null;
  workPackageLabel: string | null;
  /** @deprecated Use workPackageLabel */
  engineeringActivityLabel: string | null;
  plannedDays: number | null;
  typicalDays: number | null;
  typicalRangeLabel: string | null;
  sampleSize: number;
  projectCount: number;
  outlierStatus: string | null;
  what: string;
  why: string;
  evidence: string;
  recommendation: string | null;
  needsReview: boolean;
};

export type ProgrammeReviewPresentation = {
  projectId: string;
  projectName: string;
  items: ProgrammeReviewItem[];
  reviewItems: ProgrammeReviewItem[];
  alignedItems: ProgrammeReviewItem[];
  noComparisonItems: ProgrammeReviewItem[];
};

export type ProjectIntelligence = {
  projectId: string;
  projectName: string;
  executiveSummary: {
    projectType: string | null;
    projectCategory: string | null;
    sector: string | null;
    stage: string | null;
    currentRevision: string | null;
    revisionCount: number;
    totalDeliverables: number;
    totalDisciplines: number;
    workPackagesAnalysed: number;
    comparableCompletedProjects: number;
    overallConfidence: "LOW" | "MEDIUM" | "HIGH" | "NONE";
    overallConfidenceNote: string;
  };
  programmeHealth: {
    findings: Array<{
      kind: string;
      deliverableId: string | null;
      deliverableName: string | null;
      disciplineLabel: string | null;
      statement: string;
      source: string;
    }>;
    summary: string;
  };
  planningQuality: {
    withinExpectedRange: number;
    aboveBenchmark: number;
    belowBenchmark: number;
    noComparison: number;
    alignmentNote: string;
  };
  projectEvolutionSummary: {
    revisionCount: number;
    workPackagesTracked: number;
    replanningEvents: number;
    workPackagesWithIncreasingRemaining: number;
    workPackagesWithRemainingProgress: number;
    largestPlanningChange: {
      deliverableId: string;
      deliverableName: string;
      absoluteDays: number;
      fromDays: number | null;
      toDays: number | null;
    } | null;
    largestProgrammeGrowth: {
      deliverableId: string;
      deliverableName: string;
      remainingIncreaseDays: number;
    } | null;
    summary: string;
  };
  disciplineOverview: Array<{
    disciplineLabel: string;
    workPackageCount: number;
    withBenchmarkCoverage: number;
    withoutBenchmarkCoverage: number;
    needsReviewCount: number;
    planningConfidence: "LOW" | "MEDIUM" | "HIGH" | "NONE";
    notableRisks: string[];
    recommendations: string[];
  }>;
  historicalContext: {
    similarProjects: Array<{
      projectId: string;
      projectName: string;
      similarityScore: number;
      confidenceLevel: string;
    }>;
    completedProjectsUsed: number;
    strongestEvidence: Array<{ statement: string }>;
    weakestEvidence: Array<{ statement: string }>;
    summary: string;
  };
  plannerPriorities: Array<{
    priority: number;
    deliverableId: string;
    deliverableName: string;
    reason: string;
    source: string;
  }>;
  overallAssessment: string;
};

export const organisationalIntelligenceApi = {
  dashboard: (params?: { refresh?: boolean }) =>
    api.get<IntelligenceDashboard>("/intelligence/dashboard", {
      params: params?.refresh ? { refresh: "true" } : undefined,
    }),

  deliverableProfiles: () =>
    api.get<{ profiles: DeliverableKnowledgeProfile[]; count: number }>("/intelligence/deliverable-profiles"),

  reliabilityProfiles: () =>
    api.get<{ profiles: DeliverableReliabilityProfile[]; count: number }>("/intelligence/reliability-profiles"),

  reliabilityProfile: (classification: string) =>
    api.get<{ profile: DeliverableReliabilityProfile }>(
      `/intelligence/reliability-profiles/${encodeURIComponent(classification)}`
    ),

  regenerateReliabilityProfiles: () =>
    api.post<{ profiles: DeliverableReliabilityProfile[]; count: number; profilesUpdated: number }>(
      "/intelligence/reliability-profiles/regenerate"
    ),

  outcomeProfiles: () =>
    api.get<{ profiles: DeliverableOutcomeProfile[]; count: number }>("/intelligence/outcome-profiles"),

  outcomeProfile: (classification: string) =>
    api.get<{ profile: DeliverableOutcomeProfile }>(
      `/intelligence/outcome-profiles/${encodeURIComponent(classification)}`
    ),

  regenerateOutcomeProfiles: () =>
    api.post<{ profiles: DeliverableOutcomeProfile[]; count: number; profilesUpdated: number }>(
      "/intelligence/outcome-profiles/regenerate"
    ),

  recommendationProfiles: () =>
    api.get<{ profiles: RecommendationProfile[]; trends: RecommendationTrendGroup[]; count: number }>(
      "/intelligence/recommendation-profiles"
    ),

  recommendationProfile: (classification: string) =>
    api.get<{ profiles: RecommendationProfile[]; count: number }>(
      `/intelligence/recommendation-profiles/${encodeURIComponent(classification)}`
    ),

  regenerateRecommendationProfiles: () =>
    api.post<{
      profiles: RecommendationProfile[];
      trends: RecommendationTrendGroup[];
      count: number;
      profilesUpdated: number;
    }>("/intelligence/recommendation-profiles/regenerate"),

  trustProfiles: () =>
    api.get<{ profiles: IntelligenceTrustProfile[]; count: number }>("/intelligence/trust-profiles"),

  trustProfile: (classification: string) =>
    api.get<{ profile: IntelligenceTrustProfile }>(
      `/intelligence/trust-profiles/${encodeURIComponent(classification)}`
    ),

  regenerateTrustProfiles: () =>
    api.post<{ profiles: IntelligenceTrustProfile[]; count: number; profilesUpdated: number }>(
      "/intelligence/trust-profiles/regenerate"
    ),

  listInsights: (params?: {
    refresh?: boolean;
    classification?: string;
    projectType?: string;
    stage?: string;
    complexity?: string;
    clientType?: string;
    procurementRoute?: string;
    limit?: number;
  }) =>
    api.get<{ insights: LearnedInsight[]; count: number }>("/intelligence/insights", {
      params: params?.refresh
        ? { ...params, refresh: "true" }
        : params,
    }),
  insightsByType: (type: LearnedInsightType, params?: Record<string, string | number>) =>
    api.get<{ insights: LearnedInsight[]; count: number }>(
      `/intelligence/insights/by-type/${encodeURIComponent(type)}`,
      { params }
    ),
  getInsight: (id: string) =>
    api.get<{ insight: LearnedInsight }>(`/intelligence/insights/${encodeURIComponent(id)}`),
  regenerate: () =>
    api.post<{ insights: LearnedInsight[]; count: number }>("/intelligence/insights/regenerate"),

  organisationKnowledge: () =>
    api.get<OrganisationKnowledgeReport>("/intelligence/organisation-knowledge"),

  organisationalMemory: () =>
    api.get<OrganisationalMemoryPresentation>("/intelligence/organisational-memory"),

  workPackageBrief: (key: string) =>
    api.get<{ brief: WorkPackageBrief }>(`/intelligence/work-package-brief/${encodeURIComponent(key)}`),

  lessonsLearned: (refresh?: boolean) =>
    api.get<{ findings: LessonFinding[] }>("/intelligence/lessons-learned", {
      params: refresh ? { refresh: "true" } : undefined,
    }),
};
