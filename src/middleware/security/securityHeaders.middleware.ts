import type { NextFunction, Request, Response } from "express";
import { getRuntimeSecurityConfig } from "../../services/security/runtimeConfig.js";
import { logAbuseSignal } from "../../services/audit/immutableAudit.service.js";

const sensitiveRoutePattern = /^\/(rate-card|export|secure-approvals|audit-logs)/;
const requestBuckets = new Map<string, number[]>();

function isDevelopmentSwaggerRoute(req: Request, isProduction: boolean): boolean {
  return !isProduction && (req.path === "/api-docs" || req.path.startsWith("/api-docs/"));
}

function recent(values: number[], windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  return values.filter((value) => value >= cutoff);
}

function rateLimit(req: Request): boolean {
  if (!/^\/(secure-approvals|rate-card|export)/.test(req.path)) return false;
  const key = `${req.ip}:${req.path}`;
  const values = recent(requestBuckets.get(key) ?? [], 60_000);
  values.push(Date.now());
  requestBuckets.set(key, values);
  return values.length > 120;
}

export function productionSecurityMiddleware(req: Request, res: Response, next: NextFunction): void {
  const config = getRuntimeSecurityConfig();
  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = (name: string, value: number | string | readonly string[]) => {
    if (config.isProduction && name.toLowerCase() === "set-cookie") {
      const values = Array.isArray(value) ? value : [String(value)];
      value = values.map((cookie) => {
        let nextCookie = cookie;
        if (!/;\s*secure\b/i.test(nextCookie)) nextCookie += "; Secure";
        if (!/;\s*httponly\b/i.test(nextCookie)) nextCookie += "; HttpOnly";
        if (!/;\s*samesite=/i.test(nextCookie)) nextCookie += "; SameSite=Strict";
        return nextCookie;
      });
    }
    return originalSetHeader(name, value);
  };
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "").toLowerCase();
  if (config.enforceHttps && proto && proto !== "https" && req.hostname !== "localhost") {
    res.status(403).json({ error: "HTTPS required" });
    return;
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  const isSwaggerRoute = isDevelopmentSwaggerRoute(req, config.isProduction);
  if (!isSwaggerRoute) {
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  }

  if (sensitiveRoutePattern.test(req.path) || isSwaggerRoute) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
  }

  if (rateLimit(req)) {
    void logAbuseSignal({
      action: "SECURITY_ROUTE_RATE_LIMIT",
      resourceCategory: "http",
      resourceType: req.path,
      accessGranted: false,
      metadata: { path: req.path, method: req.method },
    });
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  next();
}
