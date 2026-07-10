"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useProject } from "@/contexts/project-context";
import {
  getApiErrorMessage,
  intelligenceApi,
  organisationalIntelligenceApi,
  type LearnedInsight,
  type SimilarProjectMatch,
} from "@/lib/api";
import { ProjectComparisonView } from "@/components/intelligence/organisation/project-comparison-view";
import { IntelligenceEmptyState } from "@/components/intelligence/intelligence-empty-state";

export default function ProjectComparisonPage() {
  const { selectedProjectId, selectedProject } = useProject();
  const [matches, setMatches] = useState<SimilarProjectMatch[]>([]);
  const [insights, setInsights] = useState<LearnedInsight[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedProjectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [similarRes, dashRes] = await Promise.all([
        intelligenceApi.similarProjects(selectedProjectId, { limit: 10 }),
        organisationalIntelligenceApi.dashboard(),
      ]);
      setMatches(similarRes.data.matches ?? []);
      setInsights(dashRes.data.insights ?? []);
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Couldn’t load project comparisons.");
      setMatches([]);
      setInsights([]);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!selectedProjectId) {
    return (
      <IntelligenceEmptyState
        title="Select a project to compare"
        description="Choose a project from the header, then Rana will show which completed projects it is most like."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href="/app">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to dashboard
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Compared with previous projects
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            How {selectedProject?.name ?? "this project"} compares with similar completed programmes in your
            organisation.
          </p>
        </div>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : null}
      </div>

      <ProjectComparisonView
        currentProjectName={selectedProject?.name ?? "This project"}
        matches={matches}
        insights={insights}
        loading={loading}
      />

      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        <Button asChild variant="outline" size="sm">
          <Link href="/app/deliverables">
            Review deliverables on this project <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
