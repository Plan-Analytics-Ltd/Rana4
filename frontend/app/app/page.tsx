"use client";

import Link from "next/link";
import { CalendarRange, FolderPlus, Package, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProject } from "@/contexts/project-context";

export default function DashboardPage() {
  const { selectedProject } = useProject();

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
    </div>
  );
}
