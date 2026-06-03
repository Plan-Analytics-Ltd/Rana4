import type { ActivityGraph } from "./network.service.js";
import { detectCycles, findDisconnectedComponents } from "./network.service.js";
import type { ComputedScheduleActivity, ScheduleDiagnostic } from "./types.js";

export function buildScheduleDiagnostics(
  graph: ActivityGraph,
  topoOrder: string[],
  activities: ComputedScheduleActivity[],
  projectEnd: Date
): ScheduleDiagnostic[] {
  const diagnostics: ScheduleDiagnostic[] = [];

  const cycles = detectCycles(graph);
  for (const cycle of cycles) {
    const labels = cycle
      .map((id) => graph.byId.get(id)?.activityCode ?? id)
      .join(" → ");
    diagnostics.push({
      code: "CPM_CYCLE",
      severity: "critical",
      message: `Circular dependency: ${labels}`,
      entityType: "network",
    });
  }

  if (topoOrder.length === 0 && graph.activityIds.size > 0 && cycles.length === 0) {
    diagnostics.push({
      code: "CPM_ORDER_FAILED",
      severity: "critical",
      message: "Could not order activity network",
      entityType: "project",
    });
  }

  const components = findDisconnectedComponents(graph);
  if (components.length > 1) {
    diagnostics.push({
      code: "DISCONNECTED_NETWORK",
      severity: "warning",
      message: `${components.length} separate logic networks — CPM uses one project start for all roots`,
      entityType: "network",
    });
  }

  for (const a of activities) {
    if (a.totalFloat < 0) {
      diagnostics.push({
        code: "NEGATIVE_FLOAT",
        severity: "critical",
        message: `Negative total float (${a.totalFloat}d) on ${a.activityCode}`,
        entityType: "activity",
        entityId: a.id,
        entityLabel: a.activityCode,
      });
    }
    const es = a.earlyStart.getTime();
    const ef = a.earlyFinish.getTime();
    const ls = a.lateStart.getTime();
    const lf = a.lateFinish.getTime();
    if (ef < es || lf < ls || lf < ef) {
      diagnostics.push({
        code: "IMPOSSIBLE_DATES",
        severity: "critical",
        message: `Impossible date order on ${a.activityCode}`,
        entityType: "activity",
        entityId: a.id,
        entityLabel: a.activityCode,
      });
    }
  }

  const critical = activities.filter((a) => a.isCritical);
  if (activities.length > 1 && critical.length === 0 && cycles.length === 0) {
    diagnostics.push({
      code: "NO_CRITICAL_PATH",
      severity: "advisory",
      message: "No critical activities (all activities have float > 0)",
      entityType: "project",
    });
  }

  if (activities.length > 0 && projectEnd.getTime() === 0) {
    diagnostics.push({
      code: "NO_PROJECT_END",
      severity: "warning",
      message: "Project finish could not be determined",
      entityType: "project",
    });
  }

  return diagnostics;
}
