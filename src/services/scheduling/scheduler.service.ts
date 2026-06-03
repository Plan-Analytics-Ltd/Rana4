import { prisma } from "../../utils/prisma.js";
import { defaultScheduleStart, startOfDay, toDayIndex } from "./calendar.service.js";
import { runForwardPass } from "./forward-pass.service.js";
import { runBackwardPass } from "./backward-pass.service.js";
import { applyCriticalFlags, identifyCriticalActivities } from "./critical-path.service.js";
import {
  buildActivityGraph,
  detectCycles,
  findDisconnectedComponents,
  topologicalSort,
} from "./network.service.js";
import { buildScheduleDiagnostics } from "./schedule-diagnostics.service.js";
import type {
  ComputedScheduleActivity,
  ScheduleActivityInput,
  ScheduleDurationScenario,
  ScheduleRelationshipInput,
  ScheduleResult,
} from "./types.js";

export type RecalculateScheduleOptions = {
  projectId: string;
  companyId: string;
  startDate?: Date;
  scenario?: ScheduleDurationScenario;
  persist?: boolean;
};

function durationOf(
  activity: ScheduleActivityInput,
  scenario: ScheduleDurationScenario
): number {
  const d = scenario === "likely" ? activity.likelyDuration : activity.bestDuration;
  return Math.max(1, Math.trunc(d));
}

export function calculateSchedule(
  activities: ScheduleActivityInput[],
  relationships: ScheduleRelationshipInput[],
  projectStart: Date,
  scenario: ScheduleDurationScenario = "best"
): ScheduleResult {
  const diagnostics: ScheduleResult["diagnostics"] = [];
  const graph = buildActivityGraph(activities, relationships);
  const cycles = detectCycles(graph);
  const topoOrder = topologicalSort(graph);

  if (cycles.length > 0 || topoOrder.length !== graph.activityIds.size) {
    const partial = buildScheduleDiagnostics(graph, topoOrder, [], projectStart);
    return {
      ok: false,
      projectStart: startOfDay(projectStart),
      projectEnd: startOfDay(projectStart),
      scenario,
      activities: [],
      criticalPathActivityIds: [],
      network: {
        activityIds: [...graph.activityIds],
        relationshipIds: graph.relationships.map((r) => r.id),
        topologicalOrder: topoOrder,
        cycleActivityIds: cycles,
        disconnectedComponents: findDisconnectedComponents(graph),
      },
      diagnostics: [...partial, ...diagnostics],
    };
  }

  const durFn = (id: string) => durationOf(graph.byId.get(id)!, scenario);
  const forward = runForwardPass(graph, topoOrder, projectStart, durFn);
  let projectEnd = projectStart;
  for (const id of graph.activityIds) {
    const ef = forward.earlyFinish.get(id)!;
    if (toDayIndex(ef) > toDayIndex(projectEnd)) projectEnd = ef;
  }

  const reverseTopo = [...topoOrder].reverse();
  const backward = runBackwardPass(
    graph,
    reverseTopo,
    projectEnd,
    forward.earlyStart,
    forward.earlyFinish,
    durFn
  );

  let computed: ComputedScheduleActivity[] = [];
  for (const id of topoOrder) {
    const row = graph.byId.get(id)!;
    const es = forward.earlyStart.get(id)!;
    const ef = forward.earlyFinish.get(id)!;
    const ls = backward.lateStart.get(id)!;
    const lf = backward.lateFinish.get(id)!;
    const tf = backward.totalFloat.get(id) ?? 0;
    const ff = backward.freeFloat.get(id) ?? 0;
    computed.push({
      id,
      activityCode: row.activityCode,
      durationDays: durFn(id),
      earlyStart: es,
      earlyFinish: ef,
      lateStart: ls,
      lateFinish: lf,
      totalFloat: tf,
      freeFloat: ff,
      isCritical: tf === 0,
      drivingRelationshipId: forward.drivingRelationshipId.get(id) ?? null,
      plannedStartDate: es,
      plannedFinishDate: ef,
    });
  }

  computed = applyCriticalFlags(computed);
  const criticalPathActivityIds = identifyCriticalActivities(computed);
  const schedDiagnostics = buildScheduleDiagnostics(graph, topoOrder, computed, projectEnd);

  return {
    ok: schedDiagnostics.every((d) => d.severity !== "critical"),
    projectStart: startOfDay(projectStart),
    projectEnd: startOfDay(projectEnd),
    scenario,
    activities: computed,
    criticalPathActivityIds,
    network: {
      activityIds: [...graph.activityIds],
      relationshipIds: graph.relationships.map((r) => r.id),
      topologicalOrder: topoOrder,
      cycleActivityIds: [],
      disconnectedComponents: findDisconnectedComponents(graph),
    },
    diagnostics: schedDiagnostics,
  };
}

export async function recalculateProjectSchedule(
  opts: RecalculateScheduleOptions
): Promise<ScheduleResult> {
  const { projectId, companyId, scenario = "best", persist = true } = opts;

  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId },
    select: { scheduleStartDate: true },
  });
  if (!project) {
    throw Object.assign(new Error("Project not found"), { status: 404 });
  }

  const start = opts.startDate
    ? defaultScheduleStart(opts.startDate)
    : project.scheduleStartDate
      ? defaultScheduleStart(project.scheduleStartDate)
      : defaultScheduleStart();

  const activities = await prisma.activity.findMany({
    where: { projectId, companyId },
    select: {
      id: true,
      activityCode: true,
      fragnetId: true,
      bestDuration: true,
      likelyDuration: true,
      constraintType: true,
      constraintDate: true,
    },
  });

  const relationships = await prisma.relationship.findMany({
    where: { projectId, companyId },
    select: {
      id: true,
      predecessorActivityId: true,
      successorActivityId: true,
      relationshipType: true,
      lag: true,
    },
  });

  const result = calculateSchedule(
    activities as ScheduleActivityInput[],
    relationships as ScheduleRelationshipInput[],
    start,
    scenario
  );

  if (persist && result.ok && result.activities.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: { scheduleStartDate: result.projectStart },
      });
      for (const a of result.activities) {
        await tx.activity.update({
          where: { id: a.id },
          data: {
            plannedStartDate: a.plannedStartDate,
            plannedFinishDate: a.plannedFinishDate,
            earlyStart: a.earlyStart,
            earlyFinish: a.earlyFinish,
            lateStart: a.lateStart,
            lateFinish: a.lateFinish,
            totalFloat: a.totalFloat,
            freeFloat: a.freeFloat,
            isCritical: a.isCritical,
            drivingRelationshipId: a.drivingRelationshipId,
          },
        });
      }
    });
  }

  return result;
}

export async function loadScheduleNetwork(projectId: string, companyId: string) {
  const activities = await prisma.activity.findMany({
    where: { projectId, companyId },
    select: {
      id: true,
      activityCode: true,
      fragnetId: true,
      bestDuration: true,
      likelyDuration: true,
      earlyStart: true,
      earlyFinish: true,
      lateStart: true,
      lateFinish: true,
      totalFloat: true,
      freeFloat: true,
      isCritical: true,
    },
  });
  const relationships = await prisma.relationship.findMany({
    where: { projectId, companyId },
    select: {
      id: true,
      predecessorActivityId: true,
      successorActivityId: true,
      relationshipType: true,
      lag: true,
    },
  });
  const graph = buildActivityGraph(
    activities as ScheduleActivityInput[],
    relationships as ScheduleRelationshipInput[]
  );
  return {
    graph,
    activities,
    relationships,
    cycles: detectCycles(graph),
    components: findDisconnectedComponents(graph),
    order: topologicalSort(graph),
  };
}
