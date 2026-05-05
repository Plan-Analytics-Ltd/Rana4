"use client";

import type { ReactNode } from "react";

type Rel = { activityCode: string; relationshipType: "FS" | "SS" | "FF" | "SF"; lag: number };
type AssignedResource = { resourceName: string; units?: number } & Record<string, unknown>;

export function ActivityRow(props: {
  activity: {
    activityCode: string;
    name: string;
    bestDuration: number;
    likelyDuration: number;
    assignedResources: unknown;
    relationships: { predecessors: Rel[]; successors: Rel[] };
  };
}) {
  const a = props.activity;
  const resources: AssignedResource[] = Array.isArray(a.assignedResources) ? (a.assignedResources as any[]) : [];

  const fmtLag = (lag: number) => (lag === 0 ? "" : lag > 0 ? `+${lag}` : String(lag));
  const fmtRel = (r: Rel) => `${r.activityCode} (${r.relationshipType}${fmtLag(r.lag) ? fmtLag(r.lag) : ""})`;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="font-medium text-slate-900 dark:text-white">
        {a.activityCode} — {a.name}
      </div>
      <div className="mt-1 text-slate-600 dark:text-slate-400">
        Duration: {a.bestDuration} / {a.likelyDuration} days
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Section title="Predecessors">
          {a.relationships.predecessors.length === 0 ? (
            <Empty>—</Empty>
          ) : (
            <ul className="list-disc pl-5">
              {a.relationships.predecessors.map((r, idx) => (
                <li key={`${r.activityCode}-${r.relationshipType}-${r.lag}-${idx}`}>{fmtRel(r)}</li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Successors">
          {a.relationships.successors.length === 0 ? (
            <Empty>—</Empty>
          ) : (
            <ul className="list-disc pl-5">
              {a.relationships.successors.map((r, idx) => (
                <li key={`${r.activityCode}-${r.relationshipType}-${r.lag}-${idx}`}>{fmtRel(r)}</li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="mt-3">
        <Section title="Resources">
          {resources.length === 0 ? (
            <Empty>—</Empty>
          ) : (
            <ul className="list-disc pl-5">
              {resources.map((r, idx) => (
                <li key={`${String(r.resourceName)}-${idx}`}>
                  {String(r.resourceName)}
                  {r.units !== undefined ? ` (${Number(r.units)} units)` : ""}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{props.title}</div>
      <div className="mt-1 text-slate-700 dark:text-slate-200">{props.children}</div>
    </div>
  );
}

function Empty(props: { children: ReactNode }) {
  return <div className="text-slate-500 dark:text-slate-400">{props.children}</div>;
}

