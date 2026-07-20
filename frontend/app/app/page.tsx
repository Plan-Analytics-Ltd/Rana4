"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarRange, FolderPlus, Loader2, Package, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProject } from "@/contexts/project-context";
import { useAuth } from "@/contexts/auth-context";
import {
  auditLogsApi,
  getApiErrorMessage,
  projectsApi,
  type AuditLogSummaryItem,
  type ProjectDashboardSummary,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { hasPermission } from "@/lib/project-permissions";

function formatSourceType(sourceType: string): string {
  return sourceType.replace(/_/g, " ").toLowerCase();
}

function formatFeedLine(item: AuditLogSummaryItem): string {
  return `${item.actorDisplayName} ${item.actionPhrase} · ${formatRelativeTime(item.createdAt)}`;
}

export default function DashboardPage() {
  const { selectedProject, selectedProjectId, selectedProjectRole } = useProject();
  const { user, loading: authLoading } = useAuth();

  const [summary, setSummary] = useState<ProjectDashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [auditItems, setAuditItems] = useState<AuditLogSummaryItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const canReadAudit = hasPermission(selectedProjectRole, "auditLog", "read");

  useEffect(() => {
    let cancelled = false;
    async function loadSummary() {
      if (!selectedProjectId) {
        setSummary(null);
        return;
      }
      try {
        setSummaryLoading(true);
        const { data } = await projectsApi.getDashboardSummary(selectedProjectId);
        if (!cancelled) setSummary(data);
      } catch (err) {
        if (!cancelled) toast.error(getApiErrorMessage(err));
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    }
    loadSummary();
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  useEffect(() => {
    let cancelled = false;
    async function loadAudit() {
      if (authLoading || !user || !canReadAudit || !selectedProjectId) {
        setAuditItems([]);
        return;
      }
      try {
        setAuditLoading(true);
        const { data } = await auditLogsApi.listSummary({ projectId: selectedProjectId, limit: 8 });
        if (!cancelled) setAuditItems(data.items);
      } catch (err) {
        if (!cancelled) toast.error(getApiErrorMessage(err));
      } finally {
        if (!cancelled) setAuditLoading(false);
      }
    }
    loadAudit();
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, user, authLoading, canReadAudit]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {selectedProject?.name ?? "Dashboard"}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          Open the planning workspace, manage deliverables, or import project data.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project workspace</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/app/schedule">
              <CalendarRange className="mr-2 h-4 w-4" />
              Open Planning Workspace
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/deliverables">
              <Package className="mr-2 h-4 w-4" />
              Manage deliverables
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/import">
              <Upload className="mr-2 h-4 w-4" />
              Import project data
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/projects/new">
              <FolderPlus className="mr-2 h-4 w-4" />
              New project
            </Link>
          </Button>
        </CardContent>
      </Card>

      {selectedProjectId ? (
        summaryLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : summary ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="dark:border-slate-800 dark:bg-slate-900/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  Deliverables
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
                  {summary.deliverablesCount}
                </p>
              </CardContent>
            </Card>
            <Card className="dark:border-slate-800 dark:bg-slate-900/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  Activities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
                  {summary.activitiesCount}
                </p>
              </CardContent>
            </Card>
            <Card className="dark:border-slate-800 dark:bg-slate-900/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  Missing duration data
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
                  {summary.deliverablesMissingDuration}
                </p>
              </CardContent>
            </Card>
            <Card className="dark:border-slate-800 dark:bg-slate-900/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  Last import
                </CardTitle>
              </CardHeader>
              <CardContent>
                {summary.lastImport ? (
                  <>
                    <p className="text-2xl font-semibold text-slate-900 dark:text-white">
                      {formatRelativeTime(summary.lastImport.importedAt)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {formatSourceType(summary.lastImport.sourceType)}
                      {summary.lastImport.label ? ` · ${summary.lastImport.label}` : null}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No imports yet</p>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null
      ) : null}

      {canReadAudit && selectedProjectId ? (
        auditLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : auditItems.length > 0 ? (
          <Card className="dark:border-slate-800 dark:bg-slate-900/50">
            <CardHeader>
              <CardTitle className="text-base">
                <Link href="/app/audit" className="hover:underline">
                  Recent activity
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {auditItems.map((log) => (
                  <li
                    key={log.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950/40 dark:text-white"
                  >
                    {formatFeedLine(log)}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : null
      ) : null}
    </div>
  );
}
