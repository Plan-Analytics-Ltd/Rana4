"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
};

export function IntelligenceEmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center dark:border-slate-600 dark:bg-slate-900/30">
      {Icon ? <Icon className="mx-auto h-8 w-8 text-violet-500 dark:text-violet-400" /> : null}
      <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm text-slate-600 dark:text-slate-400">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function IntelligenceEmptyStateButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <Button variant="outline" onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}
