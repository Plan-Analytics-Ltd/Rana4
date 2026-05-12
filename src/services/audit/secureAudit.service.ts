import {
  logAbuseSignal,
  logDecryptOperation,
  logSensitiveAccess,
  safeLogImmutableAudit,
} from "./immutableAudit.service.js";

export type SecureDecryptAuditEvent = {
  userId: string;
  companyId: string;
  resourceType: string;
  resourceId: string;
  action: string;
  timestamp?: string;
};

export type SecureQueryMetricEvent = {
  userId: string;
  companyId: string;
  table: string;
  action: string;
  durationMs: number;
  filteredCount: number;
  returnedCount: number;
  decryptCount: number;
  timestamp?: string;
};

export type SecureAuditSink = (event: Required<SecureDecryptAuditEvent>) => Promise<void> | void;
export type SecureQueryMetricSink = (event: Required<SecureQueryMetricEvent>) => Promise<void> | void;

const sinks: SecureAuditSink[] = [];
const metricSinks: SecureQueryMetricSink[] = [];

export function registerSecureAuditSink(sink: SecureAuditSink): void {
  sinks.push(sink);
}

export function registerSecureQueryMetricSink(sink: SecureQueryMetricSink): void {
  metricSinks.push(sink);
}

export async function auditSecureDecryptAccess(event: SecureDecryptAuditEvent): Promise<void> {
  const auditEvent: Required<SecureDecryptAuditEvent> = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };

  try {
    await logDecryptOperation({
      userId: auditEvent.userId,
      companyId: auditEvent.companyId,
      resourceCategory: auditEvent.resourceType,
      resourceId: auditEvent.resourceId,
      resourceType: auditEvent.resourceType,
      decryptCount: 1,
      resultCount: 1,
      metadata: { operation: auditEvent.action, timestamp: auditEvent.timestamp },
    });

    if (sinks.length > 0) {
      await Promise.all(sinks.map((sink) => sink(auditEvent)));
    }
  } catch {
    console.warn("[secure-audit] decrypt audit hook failed");
  }
}

export async function auditSecureQueryMetrics(event: SecureQueryMetricEvent): Promise<void> {
  const metricEvent: Required<SecureQueryMetricEvent> = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };

  try {
    await logSensitiveAccess({
      userId: metricEvent.userId,
      companyId: metricEvent.companyId,
      resourceCategory: metricEvent.table,
      resourceType: metricEvent.table,
      decryptCount: metricEvent.decryptCount,
      resultCount: metricEvent.returnedCount,
      queryDurationMs: metricEvent.durationMs,
      accessGranted: true,
      metadata: {
        operation: metricEvent.action,
        filteredCount: metricEvent.filteredCount,
        returnedCount: metricEvent.returnedCount,
        timestamp: metricEvent.timestamp,
      },
    });

    if (metricEvent.decryptCount >= 50 || metricEvent.durationMs >= 5_000) {
      await logAbuseSignal({
        userId: metricEvent.userId,
        companyId: metricEvent.companyId,
        resourceCategory: metricEvent.table,
        resourceType: metricEvent.table,
        decryptCount: metricEvent.decryptCount,
        resultCount: metricEvent.returnedCount,
        queryDurationMs: metricEvent.durationMs,
        accessGranted: true,
        metadata: {
          reason: "high_decrypt_or_slow_query",
          thresholdDecryptCount: 50,
          thresholdDurationMs: 5000,
        },
      });
    }

    if (metricSinks.length > 0) {
      await Promise.all(metricSinks.map((sink) => sink(metricEvent)));
    }
  } catch {
    console.warn("[secure-audit] query audit hook failed");
  }
}

export async function auditSecureAccessDenied(event: {
  userId?: string | null;
  companyId?: string | null;
  resourceType: string;
  resourceId?: string | null;
  action: string;
  reason?: string;
}): Promise<void> {
  await safeLogImmutableAudit({
    action: "ACCESS_DENIED",
    userId: event.userId ?? null,
    companyId: event.companyId ?? null,
    resourceCategory: event.resourceType,
    resourceId: event.resourceId ?? null,
    resourceType: event.resourceType,
    accessGranted: false,
    metadata: { operation: event.action, reason: event.reason },
  });
}
