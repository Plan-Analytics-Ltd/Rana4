import { prisma } from "../../utils/prisma.js";
import { auditActionPhrase, resolveUserDisplayName } from "./auditLogPhrases.js";

type AuditLogRow = {
  id: string;
  userId: string;
  createdAt: Date;
  action: string;
};

export type AuditLogSummaryItem = {
  id: string;
  createdAt: string;
  actorDisplayName: string;
  actionPhrase: string;
};

export async function enrichAuditLogsForSummary(rows: AuditLogRow[]): Promise<AuditLogSummaryItem[]> {
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const displayNameByUserId = new Map(
    users.map((u) => [u.id, resolveUserDisplayName({ name: u.name, email: u.email })])
  );

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actorDisplayName: displayNameByUserId.get(row.userId) ?? "Someone",
    actionPhrase: auditActionPhrase(row.action),
  }));
}
