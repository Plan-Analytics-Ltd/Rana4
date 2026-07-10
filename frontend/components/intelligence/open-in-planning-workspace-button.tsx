"use client";

import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { planningWorkspaceHref } from "@/lib/intelligence-ui";

type Props = {
  className?: string;
};

export function OpenInPlanningWorkspaceButton({ className }: Props) {
  return (
    <Button asChild variant="outline" size="sm" className={className}>
      <Link href={planningWorkspaceHref({ view: "workspace" })}>
        <CalendarRange className="mr-2 h-4 w-4" />
        Open in Planning Workspace
      </Link>
    </Button>
  );
}
