"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import {
  devApi,
  getApiErrorMessage,
  isAxiosError,
  type DevAdminRequestRow,
  type DevCompanyRow,
  type DevUserRow,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function DevPanelPage() {
  const { user, loading, refreshUser } = useAuth();
  const router = useRouter();
  const [forbidden, setForbidden] = useState(false);
  const [adminReq, setAdminReq] = useState<DevAdminRequestRow[]>([]);
  const [companies, setCompanies] = useState<DevCompanyRow[]>([]);
  const [users, setUsers] = useState<DevUserRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [demoteBusyId, setDemoteBusyId] = useState<string | null>(null);
  const [roleTarget, setRoleTarget] = useState<Record<string, "ADMIN" | "EDITOR" | "VIEWER">>({});

  const adminCountByCompany = users.reduce<Record<string, number>>((acc, u) => {
    if (u.role === "ADMIN") acc[u.companyName] = (acc[u.companyName] ?? 0) + 1;
    return acc;
  }, {});

  const loadAll = useCallback(async () => {
    setLoadingData(true);
    setForbidden(false);
    try {
      const [a, c, u] = await Promise.all([
        devApi.listAdminRequests(),
        devApi.listCompanies(),
        devApi.listUsers(),
      ]);
      setAdminReq(a.data.requests);
      setCompanies(c.data.companies);
      setUsers(u.data.users);
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 403) {
        setForbidden(true);
      } else {
        toast.error(getApiErrorMessage(err));
      }
      setAdminReq([]);
      setCompanies([]);
      setUsers([]);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent("/dev")}`);
      return;
    }
    if (user.devPanelAccess === undefined) {
      void refreshUser();
      return;
    }
    if (user.devPanelAccess !== true) {
      setForbidden(true);
      return;
    }
    void loadAll();
  }, [user, loading, router, loadAll, refreshUser]);

  async function approve(id: string) {
    setBusyId(id);
    try {
      await devApi.approveAdminRequest(id);
      toast.success("Approved");
      await loadAll();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id);
    try {
      await devApi.rejectAdminRequest(id);
      toast.success("Rejected");
      await loadAll();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function applyRole(userId: string) {
    const role = roleTarget[userId] ?? "VIEWER";
    setDemoteBusyId(userId);
    try {
      await devApi.setUserRole(userId, role);
      toast.success("Role updated");
      await loadAll();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setDemoteBusyId(null);
    }
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <Card className="dark:border-slate-800 dark:bg-slate-900/50">
          <CardHeader>
            <CardTitle className="text-lg">Private dev area</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p>
              This path (<code className="font-mono">/dev</code>) is part of the same site, but only the account in{" "}
              <code className="font-mono">DEV_PANEL_EMAIL</code> (or <code className="font-mono">DEV_EMAILS</code>) on
              the API may use it. Set that to your login email and restart the server.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href="/settings">Settings</Link>
              </Button>
              <Button asChild variant="default">
                <Link href="/login?next=/dev">Sign in as dev user</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Dev panel</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Approve admin requests and inspect companies and users. Restricted to <code className="font-mono text-xs">DEV_EMAILS</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={loadingData} onClick={() => void loadAll()}>
            {loadingData ? "Refreshing…" : "Refresh"}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/settings">Settings</Link>
          </Button>
        </div>
      </div>

      <Card className="dark:border-slate-800 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-base">Admin requests</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingData ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : adminReq.length === 0 ? (
            <p className="text-sm text-slate-500">No pending admin requests.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="pb-2 pr-4 font-medium">Email</th>
                    <th className="pb-2 pr-4 font-medium">Company</th>
                    <th className="pb-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {adminReq.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-4 font-mono text-xs sm:text-sm">{r.user.email}</td>
                      <td className="py-2 pr-4">{r.user.companyName}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" disabled={busyId !== null} onClick={() => void approve(r.id)}>
                            {busyId === r.id ? "…" : "Approve"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busyId !== null}
                            onClick={() => void reject(r.id)}
                          >
                            {busyId === r.id ? "…" : "Reject"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="dark:border-slate-800 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-base">Companies</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingData ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 font-medium">Users</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-4">{c.name}</td>
                      <td className="py-2">{c.userCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="dark:border-slate-800 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingData ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="pb-2 pr-4 font-medium">Email</th>
                    <th className="pb-2 pr-4 font-medium">Role</th>
                    <th className="pb-2 pr-4 font-medium">Company</th>
                    <th className="pb-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-4 font-mono text-xs sm:text-sm">{u.email}</td>
                      <td className="py-2 pr-4">{u.role}</td>
                      <td className="py-2 pr-4">{u.companyName}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 shadow-sm outline-none focus:ring-2 focus:ring-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            value={roleTarget[u.id] ?? (u.role as any)}
                            disabled={demoteBusyId !== null || (u.role === "ADMIN" && (adminCountByCompany[u.companyName] ?? 0) <= 1)}
                            onChange={(e) =>
                              setRoleTarget((prev) => ({ ...prev, [u.id]: e.target.value as "ADMIN" | "EDITOR" | "VIEWER" }))
                            }
                          >
                            <option value="ADMIN">ADMIN</option>
                            <option value="EDITOR">EDITOR</option>
                            <option value="VIEWER">VIEWER</option>
                          </select>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              demoteBusyId !== null ||
                              (u.role === "ADMIN" && (adminCountByCompany[u.companyName] ?? 0) <= 1) ||
                              (roleTarget[u.id] ?? (u.role as any)) === (u.role as any)
                            }
                            onClick={() => void applyRole(u.id)}
                          >
                            {demoteBusyId === u.id ? "…" : "Apply"}
                          </Button>
                          {u.role === "ADMIN" && (adminCountByCompany[u.companyName] ?? 0) <= 1 ? (
                            <span className="text-xs font-medium text-amber-600 dark:text-amber-300">
                              Cannot demote last admin
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
