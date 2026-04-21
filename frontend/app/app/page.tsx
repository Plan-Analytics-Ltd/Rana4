"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FileText,
  GitBranch,
  ListTodo,
  Package,
  Plus,
  Download,
  Loader2,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  standardsApi,
  fragnetsApi,
  deliverablesApi,
  activitiesApi,
  type Standard,
  type Fragnet,
  getApiErrorMessage,
} from "@/lib/api";
import { useProject } from "@/contexts/project-context";

type DashboardMetrics = {
  standards: number;
  fragnets: number;
  activities: number;
  deliverables: number;
};

export default function AppDashboardPage() {
  const { selectedProjectId } = useProject();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [recentFragnets, setRecentFragnets] = useState<Array<Fragnet & { standardName?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [standards, setStandards] = useState<Standard[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!selectedProjectId) {
          setStandards([]);
          setMetrics({ standards: 0, fragnets: 0, activities: 0, deliverables: 0 });
          setRecentFragnets([]);
          return;
        }
        const [standardsRes] = await Promise.all([standardsApi.list(selectedProjectId)]);
        const standardsList = standardsRes.data;
        if (cancelled) return;
        setStandards(standardsList);

        const fragnetLists = await Promise.all(
          standardsList.map((s) => fragnetsApi.listByStandard(s.id))
        );
        if (cancelled) return;
        const allFragnets = fragnetLists.flatMap((r) => r.data);
        const withStandard = allFragnets.map((f) => ({
          ...f,
          standardName: standardsList.find((s) => s.id === f.standardId)?.name,
        }));
        const recent = [...withStandard].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ).slice(0, 8);
        setRecentFragnets(recent);

        const [deliverablesRes, activitiesPerFragnet] = await Promise.all([
          deliverablesApi.list(selectedProjectId),
          Promise.all(allFragnets.map((f) => activitiesApi.listByFragnet(f.id))),
        ]);
        if (cancelled) return;
        const totalDeliverables = deliverablesRes.data.length;
        const totalActivities = activitiesPerFragnet.reduce((sum, r) => sum + r.data.length, 0);

        setMetrics({
          standards: standardsList.length,
          fragnets: allFragnets.length,
          activities: totalActivities,
          deliverables: totalDeliverables,
        });
      } catch (err: unknown) {
        if (!cancelled) toast.error(getApiErrorMessage(err) || "Failed to load dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [selectedProjectId]);

  const metricCards = [
    { label: "Total Standards", value: metrics?.standards ?? "—", icon: FileText, href: "/app/standards" },
    { label: "Total Fragnets", value: metrics?.fragnets ?? "—", icon: GitBranch, href: "/app/fragnets" },
    { label: "Total Activities", value: metrics?.activities ?? "—", icon: ListTodo, href: "/app/activities" },
    { label: "Total Deliverables", value: metrics?.deliverables ?? "—", icon: Package, href: "/app/deliverables" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Overview of your scheduling platform.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <section>
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Metrics
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {metricCards.map(({ label, value, icon: Icon, href }) => (
                <Link key={href} href={href}>
                  <Card className="transition-all duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/50">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                        {label}
                      </CardTitle>
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        <Icon className="h-4 w-4" />
                      </span>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                        {value}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <Card className="dark:border-slate-800 dark:bg-slate-900/50">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Recently Modified Fragnets</CardTitle>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/app/fragnets">
                    View all <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {recentFragnets.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                    No fragnets yet. Create a standard and add fragnets.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {recentFragnets.map((f) => (
                      <li key={f.id}>
                        <Link
                          href="/app/fragnets"
                          className="flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <span className="font-medium text-slate-900 dark:text-white">{f.name}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {f.standardName ?? "—"}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="dark:border-slate-800 dark:bg-slate-900/50">
              <CardHeader>
                <CardTitle className="text-base">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Button asChild className="justify-start">
                  <Link href="/app/standards">
                    <Plus className="mr-2 h-4 w-4" />
                    Create Standard
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/app/fragnets">
                    <Plus className="mr-2 h-4 w-4" />
                    Create Fragnet
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/app/export">
                    <Download className="mr-2 h-4 w-4" />
                    Export Fragnet
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
