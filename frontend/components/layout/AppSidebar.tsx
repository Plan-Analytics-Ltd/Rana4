"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  FileText,
  GitBranch,
  ListTodo,
  Tags,
  Package,
  Download,
  TableProperties,
  ClipboardList,
  Upload,
  Users,
  Settings,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useProject } from "@/contexts/project-context";
import { hasPermission } from "@/lib/project-permissions";

const platformNav = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/project", label: "Project Viewer", icon: Package },
  { href: "/app/standards", label: "Standards", icon: FileText },
  { href: "/app/fragnets", label: "Fragnets", icon: GitBranch },
  { href: "/app/activities", label: "Activities", icon: ListTodo },
  { href: "/app/activity-codes", label: "Activity codes", icon: Tags },
  { href: "/app/deliverables", label: "Deliverables", icon: Package },
  { href: "/app/rate-card", label: "Rate card", icon: TableProperties },
  { href: "/app/export", label: "Export", icon: Download },
  { href: "/app/import", label: "Import", icon: Upload },
];

const systemNav = [
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/help", label: "Help", icon: HelpCircle },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { selectedProjectRole } = useProject();

  const items = [
    ...platformNav,
    ...(hasPermission(selectedProjectRole, "projectMember", "read")
      ? [{ href: "/app/members", label: "Members", icon: Users }]
      : []),
    ...(hasPermission(selectedProjectRole, "auditLog", "read")
      ? [{ href: "/app/audit", label: "Audit log", icon: ClipboardList }]
      : []),
  ];

  const isActive = (href: string) => {
    if (href === "/app") return pathname === "/app";
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900 transition-all duration-200",
        collapsed ? "w-[72px]" : "w-60"
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-800">
        {!collapsed && (
          <Link href="/app" className="flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white"><span className="text-cyan-500 dark:text-cyan-400">Rana</span>4</span>
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {!collapsed && (
          <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-400">
            Platform
          </p>
        )}
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200",
              "hover:bg-slate-200/80 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100",
              isActive(href)
                ? "border-l-2 border-l-cyan-500 bg-cyan-500/10 pl-[calc(0.75rem-2px)] font-medium text-slate-900 dark:border-l-cyan-400 dark:bg-cyan-500/10 dark:text-white dark:hover:bg-cyan-500/10"
                : "text-slate-600 dark:text-slate-400"
            )}
            title={collapsed ? label : undefined}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </Link>
        ))}
        {!collapsed && (
          <p className="mt-4 px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-400">
            System
          </p>
        )}
        {systemNav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200",
              "hover:bg-slate-200/80 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100",
              pathname === href
                ? "border-l-2 border-l-cyan-500 bg-cyan-500/10 pl-[calc(0.75rem-2px)] font-medium text-slate-900 dark:border-l-cyan-400 dark:bg-cyan-500/10 dark:text-white"
                : "text-slate-600 dark:text-slate-400"
            )}
            title={collapsed ? label : undefined}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
