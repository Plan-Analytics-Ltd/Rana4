"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { IntelligenceHelpTooltip, INTELLIGENCE_HELP } from "@/components/intelligence/intelligence-help-tooltip";

type HelpTopic = keyof typeof INTELLIGENCE_HELP;

type Props = {
  title: string;
  description?: string;
  helpTopic?: HelpTopic;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  empty?: boolean;
  emptyContent?: ReactNode;
  className?: string;
};

export function IntelligenceSection({
  title,
  description,
  helpTopic,
  children,
  collapsible = false,
  defaultOpen = true,
  empty = false,
  emptyContent,
  className,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className={cn("border-slate-200 dark:border-slate-700", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {collapsible ? (
              <div className="flex w-full items-center gap-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setOpen((v) => !v)}
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                  )}
                  <CardTitle className="text-lg">{title}</CardTitle>
                </button>
                {helpTopic ? <IntelligenceHelpTooltip topic={helpTopic} /> : null}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">{title}</CardTitle>
                {helpTopic ? <IntelligenceHelpTooltip topic={helpTopic} /> : null}
              </div>
            )}
            {description ? (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
            ) : null}
          </div>
        </div>
      </CardHeader>
      {(!collapsible || open) && (
        <CardContent>{empty ? emptyContent : children}</CardContent>
      )}
    </Card>
  );
}
