"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CostRollup } from "@/lib/schedule-metrics";

function formatMoney(n: number): string {
  return `£${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function CostSummaryCards(props: {
  project: CostRollup;
  byFragnet?: { id: string; name: string; rollup: CostRollup }[];
}) {
  const { project, byFragnet = [] } = props;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Project cost</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold text-slate-900 dark:text-white">{formatMoney(project.totalCost)}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{project.activityCount} activities</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Total hours</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold text-slate-900 dark:text-white">{project.totalHours.toLocaleString()}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">From resource assignments</p>
        </CardContent>
      </Card>
      <Card className="sm:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">By resource type</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(project.byResourceType).length === 0 ? (
            <p className="text-sm text-slate-500">No cost data (upload rate card and assign resources).</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(project.byResourceType).map(([type, cost]) => (
                <span
                  key={type}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium dark:border-slate-700 dark:bg-slate-800"
                >
                  {type}: {formatMoney(cost)}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {byFragnet.length > 0 && (
        <Card className="sm:col-span-2 lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Cost by fragnet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {byFragnet.map((f) => (
              <div key={f.id} className="flex justify-between text-sm">
                <span className="font-medium text-slate-800 dark:text-slate-200">{f.name}</span>
                <span className="text-slate-600 dark:text-slate-400">
                  {formatMoney(f.rollup.totalCost)} · {f.rollup.activityCount} act.
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
