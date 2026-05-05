"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { useProject } from "@/contexts/project-context";
import { api, getApiErrorMessage } from "@/lib/api";
import { FragnetNode } from "@/components/project/FragnetNode";

type FullDataResponse = {
  fragnets: {
    id: string;
    name: string;
    deliverables: {
      id: string;
      name: string;
      activities: {
        id: string;
        activityCode: string;
        name: string;
        bestDuration: number;
        likelyDuration: number;
        assignedResources: unknown;
        relationships: {
          predecessors: { activityCode: string; relationshipType: "FS" | "SS" | "FF" | "SF"; lag: number }[];
          successors: { activityCode: string; relationshipType: "FS" | "SS" | "FF" | "SF"; lag: number }[];
        };
      }[];
    }[];
  }[];
};

export default function ProjectViewerPage() {
  const { selectedProjectId, selectedProject } = useProject();
  const projectId = selectedProjectId;

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FullDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      setError(null);
      setData(null);
      if (!projectId) return;
      try {
        setLoading(true);
        const res = await api.get<FullDataResponse>(`/projects/${encodeURIComponent(projectId)}/full-data`);
        setData(res.data);
      } catch (err) {
        setError(getApiErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [projectId]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Project Viewer</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Project: <span className="font-medium">{selectedProject?.name ?? "—"}</span>
        </p>
      </div>

      <Card className="p-5">
        {loading && <div className="text-sm text-slate-600 dark:text-slate-400">Loading project…</div>}

        {!loading && !projectId && (
          <div className="text-sm text-slate-600 dark:text-slate-400">Select a project first.</div>
        )}

        {!loading && error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && data && data.fragnets.length === 0 && (
          <div className="text-sm text-slate-600 dark:text-slate-400">
            No data found. Import a template to get started.
          </div>
        )}

        {!loading && !error && data && data.fragnets.length > 0 && (
          <div className="space-y-2">
            {data.fragnets.map((f) => (
              <FragnetNode key={f.id} fragnet={f} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

