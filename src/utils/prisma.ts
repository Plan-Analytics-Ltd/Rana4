import { PrismaClient } from "@prisma/client";
import { getAuthContext } from "./requestContext.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function explicitCompanyIdFromArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  const where = a.where;
  if (where && typeof where === "object" && where !== null) {
    const w = where as Record<string, unknown>;
    if (typeof w.companyId === "string" && w.companyId.trim()) return w.companyId.trim();
  }
  const data = a.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (typeof d.companyId === "string" && d.companyId.trim()) return d.companyId.trim();
  }
  const create = a.create;
  if (create && typeof create === "object" && !Array.isArray(create)) {
    const c = create as Record<string, unknown>;
    if (typeof c.companyId === "string" && c.companyId.trim()) return c.companyId.trim();
  }
  return undefined;
}

/** Tenant id from ALS, or from an explicit companyId on the query (background jobs, transactions). */
function resolveCompanyId(args: unknown): string {
  const fromCtx = getAuthContext()?.companyId?.trim();
  if (fromCtx && fromCtx !== "unknown") return fromCtx;
  const explicit = explicitCompanyIdFromArgs(args);
  if (explicit) return explicit;
  throw new Error("Missing company context");
}

function buildPrismaClient(): PrismaClient {
  const isProd = process.env.NODE_ENV === "production";
  // Use event-based logs so we can throttle noisy connection errors in dev/non-prod.
  const client = new PrismaClient({
    log: isProd
      ? ["error"]
      : [
          { emit: "event", level: "error" },
          { emit: "event", level: "warn" },
        ],
  });

  if (!isProd) {
    const lastLogAt = new Map<string, number>();
    const throttleMs = 30_000;

    const shouldLog = (key: string): boolean => {
      const now = Date.now();
      const prev = lastLogAt.get(key) ?? 0;
      if (now - prev < throttleMs) return false;
      lastLogAt.set(key, now);
      return true;
    };

    client.$on("error", (e) => {
      const key = `${e.target ?? "prisma"}:${e.message}`;
      if (shouldLog(key)) {
        // Keep it short; the underlying error can repeat during Neon restarts.
        console.error(`prisma:error ${e.message}`);
      }
    });
    client.$on("warn", (e) => {
      const key = `${e.target ?? "prisma"}:${e.message}`;
      if (shouldLog(key)) {
        console.warn(`prisma:warn ${e.message}`);
      }
    });
  }

  // Prisma v6: use query extensions instead of `$use`.
  const withCompanyScope = (modelName: string) => ({
    async $allOperations({ args, operation, query }: { args: any; operation: string; query: (args: any) => Promise<any> }) {
      const companyId = resolveCompanyId(args);

      const mergeWhere = (where: any) => {
        const base = where && typeof where === "object" ? where : {};
        if (base.companyId !== undefined) return base;
        return { ...base, companyId };
      };
      const mergeData = (data: any) => {
        const base = data && typeof data === "object" ? data : {};
        if (base.companyId !== undefined) return base;
        return { ...base, companyId };
      };

      if (operation === "findUnique") {
        // Convert to findFirst with company filter.
        return (client as any)[modelName].findFirst({ ...args, where: mergeWhere(args?.where) });
      }
      if (operation === "findMany" || operation === "findFirst" || operation === "count") {
        return query({ ...args, where: mergeWhere(args?.where) });
      }
      if (operation === "create") {
        return query({ ...args, data: mergeData(args?.data) });
      }
      if (operation === "createMany") {
        const data = args?.data;
        const nextData = Array.isArray(data) ? data.map((d) => mergeData(d)) : mergeData(data);
        return query({ ...args, data: nextData });
      }
      if (operation === "update" || operation === "updateMany" || operation === "delete" || operation === "deleteMany") {
        const nextArgs: any = { ...args, where: mergeWhere(args?.where) };
        if (operation === "update" || operation === "updateMany") nextArgs.data = mergeData(args?.data);
        return query(nextArgs);
      }
      if (operation === "upsert") {
        return query({
          ...args,
          where: mergeWhere(args?.where),
          create: mergeData(args?.create),
          update: mergeData(args?.update),
        });
      }
      return query(args);
    },
  });

  const invitationScope = () => ({
    async $allOperations({ args, operation, query }: { args: any; operation: string; query: (args: any) => Promise<any> }) {
      const ctx = getAuthContext();
      // Accept-invite flow: allow looking up an invitation by token before we know companyId.
      // Token is a high-entropy secret and unique.
      const tokenWhere = args?.where && typeof args.where === "object" ? args.where.token : undefined;
      if (
        (!ctx || !ctx.companyId || ctx.companyId === "unknown") &&
        (operation === "findUnique" || operation === "findFirst" || operation === "delete") &&
        typeof tokenWhere === "string"
      ) {
        return query(args);
      }
      const companyId = resolveCompanyId(args);

      const mergeWhere = (where: any) => {
        const base = where && typeof where === "object" ? where : {};
        if (base.companyId !== undefined) return base;
        return { ...base, companyId };
      };
      const mergeData = (data: any) => {
        const base = data && typeof data === "object" ? data : {};
        if (base.companyId !== undefined) return base;
        return { ...base, companyId };
      };

      if (operation === "findUnique") {
        return (client as any).invitation.findFirst({ ...args, where: mergeWhere(args?.where) });
      }
      if (operation === "findMany" || operation === "findFirst" || operation === "count") {
        return query({ ...args, where: mergeWhere(args?.where) });
      }
      if (operation === "create") {
        return query({ ...args, data: mergeData(args?.data) });
      }
      if (operation === "createMany") {
        const data = args?.data;
        const nextData = Array.isArray(data) ? data.map((d) => mergeData(d)) : mergeData(data);
        return query({ ...args, data: nextData });
      }
      if (operation === "update" || operation === "updateMany" || operation === "delete" || operation === "deleteMany") {
        const nextArgs: any = { ...args, where: mergeWhere(args?.where) };
        if (operation === "update" || operation === "updateMany") nextArgs.data = mergeData(args?.data);
        return query(nextArgs);
      }
      if (operation === "upsert") {
        return query({
          ...args,
          where: mergeWhere(args?.where),
          create: mergeData(args?.create),
          update: mergeData(args?.update),
        });
      }
      return query(args);
    },
  });

  const emailVerificationTokenScope = () => ({
    async $allOperations({ args, operation, query }: { args: any; operation: string; query: (args: any) => Promise<any> }) {
      const ctx = getAuthContext();
      const tokenWhere = args?.where && typeof args.where === "object" ? args.where.token : undefined;
      // Allow verifying by token before we know companyId.
      if (
        (!ctx || !ctx.companyId || ctx.companyId === "unknown") &&
        (operation === "findUnique" || operation === "findFirst" || operation === "delete" || operation === "deleteMany") &&
        typeof tokenWhere === "string"
      ) {
        return query(args);
      }
      const companyId = resolveCompanyId(args);

      const mergeWhere = (where: any) => {
        const base = where && typeof where === "object" ? where : {};
        if (base.companyId !== undefined) return base;
        return { ...base, companyId };
      };
      const mergeData = (data: any) => {
        const base = data && typeof data === "object" ? data : {};
        if (base.companyId !== undefined) return base;
        return { ...base, companyId };
      };

      if (operation === "findUnique") {
        return (client as any).emailVerificationToken.findFirst({ ...args, where: mergeWhere(args?.where) });
      }
      if (operation === "findMany" || operation === "findFirst" || operation === "count") {
        return query({ ...args, where: mergeWhere(args?.where) });
      }
      if (operation === "create") {
        return query({ ...args, data: mergeData(args?.data) });
      }
      if (operation === "createMany") {
        const data = args?.data;
        const nextData = Array.isArray(data) ? data.map((d) => mergeData(d)) : mergeData(data);
        return query({ ...args, data: nextData });
      }
      if (operation === "update" || operation === "updateMany" || operation === "delete" || operation === "deleteMany") {
        const nextArgs: any = { ...args, where: mergeWhere(args?.where) };
        if (operation === "update" || operation === "updateMany") nextArgs.data = mergeData(args?.data);
        return query(nextArgs);
      }
      if (operation === "upsert") {
        return query({
          ...args,
          where: mergeWhere(args?.where),
          create: mergeData(args?.create),
          update: mergeData(args?.update),
        });
      }
      return query(args);
    },
  });

  const projectMemberScope = () => ({
    async $allOperations({ args, operation, query }: { args: any; operation: string; query: (args: any) => Promise<any> }) {
      const ctx = getAuthContext();
      const fromCtx = ctx?.companyId?.trim();
      const fromWhere =
        args?.where?.project?.companyId != null ? String(args.where.project.companyId).trim() : "";
      const companyId = fromCtx && fromCtx !== "unknown" ? fromCtx : fromWhere;
      if (!companyId) {
        throw new Error("Missing company context");
      }

      const mergeWhere = (where: any) => {
        const base = where && typeof where === "object" ? where : {};
        if (base.project !== undefined) return base;
        return { ...base, project: { companyId } };
      };

      if (operation === "findUnique") {
        // Convert to findFirst with company filter (safe fallback).
        return (client as any).projectMember.findFirst({ ...args, where: mergeWhere(args?.where) });
      }
      if (operation === "findMany" || operation === "findFirst" || operation === "count") {
        return query({ ...args, where: mergeWhere(args?.where) });
      }
      if (operation === "update" || operation === "updateMany" || operation === "delete" || operation === "deleteMany") {
        return query({ ...args, where: mergeWhere(args?.where) });
      }
      // For create/createMany/upsert, rely on explicit projectId and the FK to projects.
      return query(args);
    },
  });

  const extended = client.$extends({
    query: {
      standard: withCompanyScope("standard"),
      assuranceNote: withCompanyScope("assuranceNote"),
      fragnet: withCompanyScope("fragnet"),
      deliverable: withCompanyScope("deliverable"),
      activity: withCompanyScope("activity"),
      relationship: withCompanyScope("relationship"),
      project: withCompanyScope("project"),
      projectMember: projectMemberScope(),
      auditLog: withCompanyScope("auditLog"),
      invitation: invitationScope(),
      emailVerificationToken: emailVerificationTokenScope(),
    },
  });

  return extended as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? buildPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const CONNECTION_ERROR_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);

export function isPrismaConnectionError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string" &&
    CONNECTION_ERROR_CODES.has((err as { code: string }).code)
  );
}

/** Retry once after reconnecting (Neon / idle pool drops). */
export async function withPrismaRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isPrismaConnectionError(err)) throw err;
    await prisma.$connect();
    return await fn();
  }
}

export async function connectPrisma(): Promise<void> {
  await prisma.$connect();
}
