"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { auditLogsApi, getApiErrorMessage, type AuditLogItem } from "@/lib/api";
import { useProject } from "@/contexts/project-context";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/project-permissions";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function AuditLogPage() {
  const { selectedProjectId, selectedProjectRole } = useProject();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");

  const filters = useMemo(
    () => ({
      userId: userId.trim() || undefined,
      action: action.trim() || undefined,
    }),
    [userId, action]
  );

  const canReadAudit = hasPermission(selectedProjectRole, "auditLog", "read");

  useEffect(() => {
    if (!selectedProjectId) return;
    if (!canReadAudit) {
      router.replace("/app");
    }
  }, [canReadAudit, router, selectedProjectId]);

  useEffect(() => {
    let cancelled = false;
    async function loadFirstPage() {
      try {
        setLoading(true);
        setItems([]);
        setNextCursor(null);
        if (authLoading) return;
        if (!user) return;
        if (!canReadAudit) return;
        if (!selectedProjectId) {
          return;
        }
        const { data } = await auditLogsApi.list({
          projectId: selectedProjectId,
          userId: filters.userId,
          action: filters.action,
          limit: 50,
        });
        if (cancelled) return;
        setItems(data.items);
        setNextCursor(data.nextCursor);
      } catch (err) {
        if (!cancelled) toast.error(getApiErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadFirstPage();
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, filters.userId, filters.action, user, authLoading, canReadAudit]);

  async function loadMore() {
    if (!selectedProjectId) return;
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const { data } = await auditLogsApi.list({
        projectId: selectedProjectId,
        userId: filters.userId,
        action: filters.action,
        limit: 50,
        cursor: nextCursor,
      });
      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Audit log</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Timeline of actions recorded in this system.
        </p>
      </div>

      {authLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : !user ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Sign in to view audit logs.
        </div>
      ) : (
      <Card className="dark:border-slate-800 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">User ID</label>
            <Input
              placeholder="Optional userId"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Action</label>
            <Input
              placeholder='Optional action (e.g. "CREATE_PROJECT")'
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div className="hidden lg:block" />
        </CardContent>
      </Card>
      )}

      {!selectedProjectId ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Select a project to view audit logs.
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          No activity recorded.
        </div>
      ) : (
        <Card className="dark:border-slate-800 dark:bg-slate-900/50">
          <CardHeader>
            <CardTitle className="text-base">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {items.map((log) => (
                <li key={log.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="flex flex-col gap-1">
                    <div className="text-sm text-slate-900 dark:text-white">
                      <span className="font-medium">{log.userId}</span> performed{" "}
                      <span className="font-mono">{log.action}</span> on{" "}
                      <span className="font-mono">{log.entity}</span>
                      {log.entityId ? (
                        <>
                          {" "}
                          (<span className="font-mono">{log.entityId}</span>)
                        </>
                      ) : null}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{formatTime(log.createdAt)}</div>
                  </div>
                  {log.details && typeof log.details === "object" && (log.details as any).type === "update" ? (
                    <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                      <div className="font-medium text-slate-700 dark:text-slate-200">Changes</div>
                      <ul className="mt-2 space-y-1">
                        {Object.entries((log.details as any).changes ?? {}).map(([field, ch]) => (
                          <li key={field} className="font-mono">
                            {field}: {JSON.stringify((ch as any)?.from)} → {JSON.stringify((ch as any)?.to)}
                          </li>
                        ))}
                      </ul>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-slate-600 dark:text-slate-300">View raw diff JSON</summary>
                        <pre className="mt-2 overflow-auto rounded bg-white p-2 text-[11px] text-slate-800 dark:bg-slate-950 dark:text-slate-100">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ) : log.details ? (
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer text-slate-600 dark:text-slate-300">View details</summary>
                      <pre className="mt-2 overflow-auto rounded bg-slate-50 p-3 text-[11px] text-slate-800 dark:bg-slate-900/40 dark:text-slate-100">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ol>

            <div className="mt-6 flex justify-center">
              {nextCursor ? (
                <Button type="button" variant="outline" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">End of activity.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

