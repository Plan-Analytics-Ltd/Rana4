"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Search, Moon, Sun, User, LogOut, X } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/contexts/auth-context";
import { useProject } from "@/contexts/project-context";
import { useSearch } from "@/contexts/search-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function getBreadcrumbs(pathname: string): { label: string; href: string }[] {
  if (pathname === "/app") return [{ label: "Dashboard", href: "/app" }];
  const segments = pathname.replace(/^\/app\/?/, "").split("/").filter(Boolean);
  const crumbs: { label: string; href: string }[] = [{ label: "App", href: "/app" }];
  let href = "/app";
  for (const seg of segments) {
    href += `/${seg}`;
    const label = seg.charAt(0).toUpperCase() + seg.slice(1);
    crumbs.push({ label, href });
  }
  return crumbs;
}

const pageTitles: Record<string, string> = {
  "/app": "Dashboard",
  "/app/projects/new": "New project",
  "/app/standards": "Standards",
  "/app/fragnets": "Fragnets",
  "/app/activities": "Activities",
  "/app/activity-codes": "Activity codes",
  "/app/deliverables": "Deliverables",
  "/app/export": "Export",
  "/app/import": "Import",
  "/app/schedule": "Planning Workspace",
  "/app/audit": "Audit log",
};

export function AppHeader() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { projects, selectedProjectId, setSelectedProjectId, loading: projectsLoading } = useProject();
  const { query, setQuery, clear } = useSearch();
  const breadcrumbs = pathname.startsWith("/app") ? getBreadcrumbs(pathname) : [];
  const pageTitle =
    pathname === "/app/schedule"
      ? "Planning Workspace"
      : pageTitles[pathname] ?? breadcrumbs[breadcrumbs.length - 1]?.label ?? "Rana4";

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <nav
            className="flex min-w-0 items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400"
            aria-label="Breadcrumb"
          >
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.href} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />}
                {i === breadcrumbs.length - 1 ? (
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{crumb.label}</span>
                ) : (
                  <Link href={crumb.href} className="hover:text-slate-700 dark:hover:text-slate-300">
                    {crumb.label}
                  </Link>
                )}
              </span>
            ))}
          </nav>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-3 lg:gap-4">
          {projectsLoading ? (
            <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              Loading projects…
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                No projects available
              </div>
              {user?.role === "ADMIN" ? (
                <Button asChild size="sm" variant="outline" className="h-10">
                  <Link href="/settings">Create project</Link>
                </Button>
              ) : (
                <span className="text-sm text-slate-500 dark:text-slate-400">Contact an admin</span>
              )}
            </div>
          ) : (
            <select
              value={selectedProjectId ?? ""}
              onChange={(e) => setSelectedProjectId(e.target.value || null)}
              className={cn(
                "h-10 min-w-[10rem] max-w-[240px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm",
                "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              )}
              aria-label="Select project"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

          <div className="relative w-full min-w-[12rem] sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by ID or name…"
              className="h-10 pl-10 pr-10"
              aria-label={`Search ${pageTitle}`}
            />
            {query.trim() ? (
              <button
                type="button"
                onClick={clear}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Clear search"
                title="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1 border-slate-200 pl-1 sm:border-l sm:pl-4 dark:border-slate-700">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link
              href="/settings"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
              title={user?.name ?? user?.email ?? "Account"}
            >
              <User className="h-4 w-4" />
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              onClick={logout}
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
