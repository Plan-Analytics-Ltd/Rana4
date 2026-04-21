"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/contexts/auth-context";
import {
  adminApi,
  authApi,
  companyApi,
  getApiErrorMessage,
  projectsApi,
  type AdminPendingRequest,
  type AdminRequestMine,
} from "@/lib/api";
import { useProject } from "@/contexts/project-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Moon, Sun } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
const BACKEND_URL =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000")
    : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { user, loading, refreshUser } = useAuth();
  const { refreshProjects } = useProject();
  const router = useRouter();
  const [name, setName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectSaving, setProjectSaving] = useState(false);
  const [companyNameDisplay, setCompanyNameDisplay] = useState("");
  const [joinCodeDisplay, setJoinCodeDisplay] = useState("");
  const [joinCodeLoading, setJoinCodeLoading] = useState(false);
  const [joinCodeRegenSaving, setJoinCodeRegenSaving] = useState(false);
  const [myAdminRequest, setMyAdminRequest] = useState<AdminRequestMine | null | undefined>(undefined);
  const [myAdminReqLoading, setMyAdminReqLoading] = useState(false);
  const [adminReqSubmitting, setAdminReqSubmitting] = useState(false);
  const [pendingAdminList, setPendingAdminList] = useState<AdminPendingRequest[]>([]);
  const [pendingAdminLoading, setPendingAdminLoading] = useState(false);
  const [adminRowBusy, setAdminRowBusy] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(typeof window !== "undefined" ? window.location.origin : "");
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    setName(user.name ?? "");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user || user.role !== "ADMIN") return;
    let cancelled = false;
    setJoinCodeLoading(true);
    companyApi
      .getJoinCode()
      .then(({ data }) => {
        if (!cancelled) {
          setCompanyNameDisplay(data.companyName);
          setJoinCodeDisplay(data.joinCode);
        }
      })
      .catch(() => {
        if (!cancelled) setJoinCodeDisplay("");
      })
      .finally(() => {
        if (!cancelled) setJoinCodeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || user.role === "ADMIN") return;
    let cancelled = false;
    setMyAdminReqLoading(true);
    adminApi
      .getMyRequest()
      .then(({ data }) => {
        if (!cancelled) setMyAdminRequest(data.request);
      })
      .catch(() => {
        if (!cancelled) setMyAdminRequest(null);
      })
      .finally(() => {
        if (!cancelled) setMyAdminReqLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const loadPendingAdminRequests = useCallback(() => {
    if (!user || user.role !== "ADMIN") return;
    setPendingAdminLoading(true);
    adminApi
      .listPending()
      .then(({ data }) => setPendingAdminList(data.requests))
      .catch(() => setPendingAdminList([]))
      .finally(() => setPendingAdminLoading(false));
  }, [user]);

  useEffect(() => {
    loadPendingAdminRequests();
  }, [loadPendingAdminRequests]);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    setPasswordSaving(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password updated");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setNameSaving(true);
    try {
      await authApi.updateMe({ name: name.trim() || undefined });
      await refreshUser();
      toast.success("Display name updated");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setNameSaving(false);
    }
  }

  async function handleSubmitAdminRequest() {
    if (!user) return;
    setAdminReqSubmitting(true);
    try {
      const { data } = await adminApi.createRequest();
      setMyAdminRequest(data.request);
      toast.success("Request submitted. Waiting for approval.");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setAdminReqSubmitting(false);
    }
  }

  async function handleApproveAdminRequest(id: string) {
    setAdminRowBusy(id);
    try {
      await adminApi.approve(id);
      toast.success("Request approved");
      loadPendingAdminRequests();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setAdminRowBusy(null);
    }
  }

  async function handleRejectAdminRequest(id: string) {
    setAdminRowBusy(id);
    try {
      await adminApi.reject(id);
      toast.success("Request rejected");
      loadPendingAdminRequests();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setAdminRowBusy(null);
    }
  }

  async function handleRegenerateJoinCode() {
    if (!user) return;
    setJoinCodeRegenSaving(true);
    try {
      const { data } = await companyApi.regenerateJoinCode();
      setJoinCodeDisplay(data.joinCode);
      toast.success("Join code updated", { description: `New code: ${data.joinCode}` });
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setJoinCodeRegenSaving(false);
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setProjectSaving(true);
    try {
      const nameStr = projectName.trim();
      if (!nameStr) {
        toast.error("Project name is required");
        return;
      }
      await projectsApi.create({ name: nameStr });
      setProjectName("");
      await refreshProjects();
      toast.success("Project created");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setProjectSaving(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Account and system preferences.
        </p>
      </div>

      {user.role === "ADMIN" ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/80 p-3 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <p className="font-medium text-emerald-900 dark:text-emerald-100">You are currently an admin.</p>
        </div>
      ) : null}

      <Card className="dark:border-slate-800 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Theme and display.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Theme</span>
            <div className="flex gap-2">
              <Button
                variant={theme === "light" ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme("light")}
              >
                <Sun className="mr-1.5 h-4 w-4" />
                Light
              </Button>
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme("dark")}
              >
                <Moon className="mr-1.5 h-4 w-4" />
                Dark
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="dark:border-slate-800 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Your profile and sign-in details.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
            <Input
              value={user.email}
              readOnly
              className="max-w-xs font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">Email cannot be changed here.</p>
          </div>
          <form onSubmit={handleSaveName} className="grid gap-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Display name</label>
            <div className="flex gap-2">
              <Input
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="max-w-xs dark:border-slate-700 dark:bg-slate-900"
              />
              <Button type="submit" size="sm" disabled={nameSaving}>
                {nameSaving ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
          <form onSubmit={handleChangePassword} className="space-y-3 border-t border-slate-200 pt-6 dark:border-slate-700">
            <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">Password</h4>
            <div className="grid max-w-xs gap-2">
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="dark:border-slate-700 dark:bg-slate-900"
              />
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="New password (min 8 characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="dark:border-slate-700 dark:bg-slate-900"
              />
              <Button type="submit" size="sm" disabled={passwordSaving}>
                {passwordSaving ? "Updating…" : "Update password"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {user.role !== "ADMIN" && (
        <Card className="dark:border-slate-800 dark:bg-slate-900/50">
          <CardHeader>
            <CardTitle className="text-base">Company administrator</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Request promotion to company admin. An existing admin can approve you in Settings.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {myAdminReqLoading || myAdminRequest === undefined ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
            ) : myAdminRequest?.status === "PENDING" ? (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/80 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
                <p className="font-medium text-amber-900 dark:text-amber-100">Status: PENDING</p>
                <p className="text-amber-800/90 dark:text-amber-200/90">
                  Waiting for admin approval. Submitted {new Date(myAdminRequest.createdAt).toLocaleString()}
                </p>
              </div>
            ) : myAdminRequest?.status === "APPROVED" ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/80 p-3 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/30">
                <p className="font-medium text-emerald-900 dark:text-emerald-100">Status: APPROVED</p>
                <p className="text-emerald-800/90 dark:text-emerald-200/90">
                  You are now an admin. Refreshing your session may be required.
                </p>
              </div>
            ) : myAdminRequest?.status === "REJECTED" ? (
              <div className="space-y-4">
                <div className="rounded-md border border-red-200 bg-red-50/80 p-3 text-sm dark:border-red-900/40 dark:bg-red-950/30">
                  <p className="font-medium text-red-900 dark:text-red-100">Status: REJECTED</p>
                  <p className="text-red-800/90 dark:text-red-200/90">
                    Request denied. You can submit a new request below.
                  </p>
                </div>
                <div className="space-y-3">
                  <Button
                    type="button"
                    size="sm"
                    disabled={adminReqSubmitting}
                    onClick={() => void handleSubmitAdminRequest()}
                  >
                    {adminReqSubmitting ? "Submitting…" : "Submit admin request"}
                  </Button>
                </div>
              </div>
            ) : myAdminRequest ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
                <p className="font-medium text-slate-800 dark:text-slate-100">Status: {myAdminRequest.status}</p>
                <p className="text-slate-600 dark:text-slate-300">
                  Last request from {new Date(myAdminRequest.createdAt).toLocaleString()}.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <Button type="button" size="sm" disabled={adminReqSubmitting} onClick={() => void handleSubmitAdminRequest()}>
                  {adminReqSubmitting ? "Submitting…" : "Submit admin request"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {user.role === "ADMIN" && (
        <Card className="dark:border-slate-800 dark:bg-slate-900/50">
          <CardHeader>
            <CardTitle className="text-base">Company</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Company name, join code, and invite link (admin only). Invite teammates with the link — no email required
              for join-code signup.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/30">
              <p className="text-center text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                — Company —
              </p>
              <div className="grid gap-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Company name</span>
                <p className="text-sm text-slate-900 dark:text-slate-100">{joinCodeLoading ? "Loading…" : companyNameDisplay || "—"}</p>
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Join code</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    readOnly
                    value={joinCodeLoading ? "Loading…" : joinCodeDisplay}
                    className="max-w-md font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={joinCodeLoading || joinCodeRegenSaving}
                    onClick={() => void handleRegenerateJoinCode()}
                  >
                    {joinCodeRegenSaving ? "Updating…" : "Regenerate"}
                  </Button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Regenerating invalidates the previous code and any old invite links.
                </p>
              </div>
              {joinCodeDisplay && !joinCodeLoading ? (
                <div className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Invite link</span>
                  <Input
                    readOnly
                    value={
                      origin
                        ? `${origin}/signup?joinCode=${encodeURIComponent(joinCodeDisplay)}`
                        : `/signup?joinCode=${encodeURIComponent(joinCodeDisplay)}`
                    }
                    className="font-mono text-xs dark:border-slate-700 dark:bg-slate-900 sm:text-sm"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-fit"
                    disabled={!origin}
                    onClick={() => {
                      const url = `${origin}/signup?joinCode=${encodeURIComponent(joinCodeDisplay)}`;
                      void navigator.clipboard.writeText(url).then(() => {
                        toast.success("Invite link copied");
                      });
                    }}
                  >
                    Copy invite link
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="space-y-2 border-b border-slate-200 pb-6 dark:border-slate-700">
              <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">Pending admin requests</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Promote teammates to company administrator. Codes are never shown here; approve or reject from this
                list.
              </p>
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" disabled={pendingAdminLoading} onClick={() => loadPendingAdminRequests()}>
                  Refresh
                </Button>
              </div>
              {pendingAdminLoading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
              ) : pendingAdminList.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No pending requests.</p>
              ) : (
                <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                  {pendingAdminList.map((r) => (
                    <li key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{r.user.email}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Role {r.user.role} · requested {new Date(r.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={adminRowBusy !== null}
                          onClick={() => void handleApproveAdminRequest(r.id)}
                        >
                          {adminRowBusy === r.id ? "…" : "Approve"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={adminRowBusy !== null}
                          onClick={() => void handleRejectAdminRequest(r.id)}
                        >
                          {adminRowBusy === r.id ? "…" : "Reject"}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form onSubmit={handleCreateProject} className="grid gap-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Create project</label>
              <div className="flex gap-2">
                <Input
                  placeholder="New project name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  required
                  className="max-w-xs dark:border-slate-700 dark:bg-slate-900"
                />
                <Button type="submit" size="sm" disabled={projectSaving}>
                  {projectSaving ? "Creating…" : "Create"}
                </Button>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Projects are the access boundary inside your company.
              </p>
            </form>

            <p className="border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Company onboarding uses the join link only (no email flow). After someone joins, add them to projects from
              the workspace as needed.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="dark:border-slate-800 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-base">System</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Version and backend.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Rana4 Frontend v0.1.0
            </span>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Backend URL</label>
            <Input
              value={BACKEND_URL}
              readOnly
              className="font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">API base URL used by the frontend (read-only).</p>
          </div>
          {user.devPanelAccess ? (
            <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Private dev panel</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Same site URL path <code className="font-mono">/dev</code> — approvals and directory (your login only,
                per server config).
              </p>
              <Button asChild className="mt-2" size="sm" variant="secondary">
                <Link href="/dev">Open /dev</Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="dark:border-slate-800 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-base">Integrations</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Future integrations and extensions.
          </p>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Placeholder for future integration options.
          </p>
        </CardContent>
      </Card>

      <div>
        <Button asChild variant="outline">
          <Link href="/app">Back to platform</Link>
        </Button>
      </div>
    </div>
  );
}
