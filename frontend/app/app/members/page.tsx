"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { projectsApi, getApiErrorMessage, type ProjectMemberRow } from "@/lib/api";
import { useProject } from "@/contexts/project-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Role = "ADMIN" | "EDITOR" | "VIEWER";

export default function ProjectMembersPage() {
  const { selectedProjectId, selectedProject, selectedProjectRole } = useProject();
  const [members, setMembers] = useState<ProjectMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const adminCount = useMemo(
    () => members.filter((m) => m.role === "ADMIN").length,
    [members]
  );

  const canManage = selectedProjectRole === "ADMIN";

  const lastAdminUserId = useMemo(() => {
    if (adminCount !== 1) return null;
    const only = members.find((m) => m.role === "ADMIN");
    return only?.userId ?? null;
  }, [adminCount, members]);

  async function load() {
    if (!selectedProjectId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await projectsApi.listMembers(selectedProjectId);
      setMembers(data.members);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  async function updateRole(userId: string, role: Role) {
    if (!selectedProjectId) return;
    setBusyUserId(userId);
    try {
      await projectsApi.updateMemberRole(selectedProjectId, userId, { role });
      toast.success("Role updated");
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Project members</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {selectedProject ? (
              <>
                Manage roles for <span className="font-medium text-slate-700 dark:text-slate-200">{selectedProject.name}</span>.
              </>
            ) : (
              "Manage roles for your selected project."
            )}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {!selectedProjectId ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Select a project to manage members.
        </div>
      ) : !canManage ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <p className="font-medium text-slate-900 dark:text-white">No access</p>
          <p className="mt-1">Only project admins can manage member roles.</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : (
        <Card className="dark:border-slate-800 dark:bg-slate-900/50">
          <CardHeader>
            <CardTitle className="text-base">Members</CardTitle>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No members found.</p>
            ) : (
              <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                {members.map((m) => {
                  const isLastAdmin = m.role === "ADMIN" && lastAdminUserId === m.userId;
                  const disabled = !canManage || isLastAdmin || busyUserId !== null;
                  return (
                    <li key={m.userId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{m.email}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{m.name ?? "—"}</p>
                        {isLastAdmin ? (
                          <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                            Cannot demote the last admin
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:ring-2 focus:ring-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          value={m.role}
                          disabled={disabled}
                          onChange={(e) => void updateRole(m.userId, e.target.value as Role)}
                        >
                          <option value="ADMIN">ADMIN</option>
                          <option value="EDITOR">EDITOR</option>
                          <option value="VIEWER">VIEWER</option>
                        </select>
                        {busyUserId === m.userId ? (
                          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

