import { AsyncLocalStorage } from "node:async_hooks";

export type AuthContext = {
  userId: string;
  companyId: string;
  requestId?: string;
  traceId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  approvalToken?: string;
};

const storage = new AsyncLocalStorage<AuthContext>();

export function runWithAuthContext<T>(ctx: AuthContext, fn: () => T): T {
  return storage.run({ ...(storage.getStore() ?? {}), ...ctx }, fn);
}

export async function runWithAuthContextAsync<T>(ctx: AuthContext, fn: () => Promise<T>): Promise<T> {
  return await storage.run({ ...(storage.getStore() ?? {}), ...ctx }, fn);
}

export function getAuthContext(): AuthContext | null {
  return storage.getStore() ?? null;
}

