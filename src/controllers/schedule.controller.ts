import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import {
  calculateSchedule,
  loadScheduleNetwork,
  recalculateProjectSchedule,
} from "../services/scheduling/scheduler.service.js";
import type { ScheduleDurationScenario } from "../services/scheduling/types.js";
import { defaultScheduleStart } from "../services/scheduling/calendar.service.js";
import { prisma } from "../utils/prisma.js";

function serializeDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function serializeActivity(a: {
  id: string;
  activityCode: string;
  earlyStart: Date;
  earlyFinish: Date;
  lateStart: Date;
  lateFinish: Date;
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
  drivingRelationshipId: string | null;
  plannedStartDate: Date;
  plannedFinishDate: Date;
  durationDays: number;
}) {
  return {
    id: a.id,
    activityCode: a.activityCode,
    durationDays: a.durationDays,
    earlyStart: serializeDate(a.earlyStart),
    earlyFinish: serializeDate(a.earlyFinish),
    lateStart: serializeDate(a.lateStart),
    lateFinish: serializeDate(a.lateFinish),
    totalFloat: a.totalFloat,
    freeFloat: a.freeFloat,
    isCritical: a.isCritical,
    drivingRelationshipId: a.drivingRelationshipId,
    plannedStartDate: serializeDate(a.plannedStartDate),
    plannedFinishDate: serializeDate(a.plannedFinishDate),
  };
}

export async function recalculateSchedule(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId } = req.params as { id: string };
    const body = req.body as {
      startDate?: string;
      scenario?: ScheduleDurationScenario;
      persist?: boolean;
    };

    const membership = await requireProjectAccess(projectId, req.user);
    requirePermission(membership.role, "activity", "update");

    const startDate = body.startDate ? defaultScheduleStart(new Date(body.startDate)) : undefined;
    const result = await recalculateProjectSchedule({
      projectId,
      companyId: req.user.companyId,
      startDate,
      scenario: body.scenario === "likely" ? "likely" : "best",
      persist: body.persist !== false,
    });

    res.json({
      ok: result.ok,
      projectStart: serializeDate(result.projectStart),
      projectEnd: serializeDate(result.projectEnd),
      scenario: result.scenario,
      activities: result.activities.map(serializeActivity),
      criticalPathActivityIds: result.criticalPathActivityIds,
      network: result.network,
      diagnostics: result.diagnostics,
    });
  } catch (err: unknown) {
    const status =
      err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    res.status(status).json({
      error: err instanceof Error ? err.message : "Failed to recalculate schedule",
    });
  }
}

export async function getScheduleNetwork(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId } = req.params as { id: string };
    const membership = await requireProjectAccess(projectId, req.user);
    requirePermission(membership.role, "activity", "read");

    const net = await loadScheduleNetwork(projectId, req.user.companyId);
    const deliverableRelationships = await prisma.deliverableRelationship.findMany({
      where: { projectId, companyId: req.user.companyId },
      select: {
        id: true,
        fragnetId: true,
        predecessorDeliverableId: true,
        successorDeliverableId: true,
        relationshipType: true,
        lag: true,
      },
      orderBy: { id: "asc" },
    });
    const deliverableActivityRelationships = await prisma.deliverableActivityRelationship.findMany({
      where: { projectId, companyId: req.user.companyId },
      select: {
        id: true,
        fragnetId: true,
        predecessorDeliverableId: true,
        successorActivityId: true,
        relationshipType: true,
        lag: true,
      },
      orderBy: { id: "asc" },
    });
    const activityToDeliverableRelationships = await prisma.activityToDeliverableRelationship.findMany({
      where: { projectId, companyId: req.user.companyId },
      select: {
        id: true,
        fragnetId: true,
        predecessorActivityId: true,
        successorDeliverableId: true,
        relationshipType: true,
        lag: true,
      },
      orderBy: { id: "asc" },
    });
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: req.user.companyId },
      select: { scheduleStartDate: true },
    });

    const start = project?.scheduleStartDate
      ? defaultScheduleStart(project.scheduleStartDate)
      : defaultScheduleStart();

    const preview = calculateSchedule(
      net.activities as Parameters<typeof calculateSchedule>[0],
      net.relationships as Parameters<typeof calculateSchedule>[1],
      start,
      "best"
    );

    res.json({
      projectStart: serializeDate(start),
      network: {
        activityIds: [...net.graph.activityIds],
        relationshipIds: net.relationships.map((r) => r.id),
        topologicalOrder: net.order,
        cycleActivityIds: net.cycles,
        disconnectedComponents: net.components,
      },
      relationships: net.relationships.map((r) => ({
        id: r.id,
        predecessorActivityId: r.predecessorActivityId,
        successorActivityId: r.successorActivityId,
        relationshipType: r.relationshipType,
        lag: r.lag,
      })),
      deliverableRelationships,
      deliverableActivityRelationships,
      activityToDeliverableRelationships,
      diagnostics: preview.diagnostics,
      activities: net.activities.map((a) => ({
        id: a.id,
        activityCode: a.activityCode,
        earlyStart: serializeDate(a.earlyStart),
        earlyFinish: serializeDate(a.earlyFinish),
        lateStart: serializeDate(a.lateStart),
        lateFinish: serializeDate(a.lateFinish),
        totalFloat: a.totalFloat,
        freeFloat: a.freeFloat,
        isCritical: a.isCritical,
      })),
    });
  } catch (err: unknown) {
    console.error(err);
    res.status(500).json({ error: "Failed to load schedule network" });
  }
}

export async function getCriticalPath(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId } = req.params as { id: string };
    const membership = await requireProjectAccess(projectId, req.user);
    requirePermission(membership.role, "activity", "read");

    const activities = await prisma.activity.findMany({
      where: { projectId, companyId: req.user.companyId, isCritical: true },
      select: {
        id: true,
        activityCode: true,
        name: true,
        earlyStart: true,
        earlyFinish: true,
        totalFloat: true,
        fragnetId: true,
      },
      orderBy: { earlyStart: "asc" },
    });

    res.json({
      count: activities.length,
      activities: activities.map((a) => ({
        id: a.id,
        activityCode: a.activityCode,
        name: a.name,
        fragnetId: a.fragnetId,
        earlyStart: serializeDate(a.earlyStart),
        earlyFinish: serializeDate(a.earlyFinish),
        totalFloat: a.totalFloat,
      })),
    });
  } catch (err: unknown) {
    console.error(err);
    res.status(500).json({ error: "Failed to load critical path" });
  }
}
