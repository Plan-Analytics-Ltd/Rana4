import { prisma } from "../utils/prisma.js";

export type AuditInput = {
  userId: string;
  companyId: string;
  projectId: string;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: unknown;
};

export async function auditLog(input: AuditInput): Promise<void> {
  const projectId = input.projectId != null ? String(input.projectId).trim() : "";
  if (!projectId) {
    throw new Error("AuditLog requires projectId");
  }
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      companyId: input.companyId,
      projectId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      details: (input.details ?? {}) as any,
    },
  });
}

