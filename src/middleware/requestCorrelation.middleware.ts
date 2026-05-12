import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { runWithAuthContext } from "../utils/requestContext.js";

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function cleanId(value: string | undefined, fallback: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 128);
}

export function requestCorrelation(req: Request, res: Response, next: NextFunction): void {
  const requestId = cleanId(headerValue(req.headers["x-request-id"]), randomUUID());
  const traceId = cleanId(headerValue(req.headers["x-trace-id"]) ?? requestId, requestId);
  const sessionId = cleanId(headerValue(req.headers["x-session-id"]), "");
  const approvalToken = cleanId(headerValue(req.headers["x-approval-token"]), "");

  res.setHeader("X-Request-Id", requestId);
  runWithAuthContext(
    {
      userId: "anonymous",
      companyId: "unknown",
      requestId,
      traceId,
      ...(sessionId ? { sessionId } : {}),
      ...(approvalToken ? { approvalToken } : {}),
      ipAddress: req.ip,
      userAgent: headerValue(req.headers["user-agent"]),
    },
    () => next()
  );
}
