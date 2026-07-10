"use client";

import Link from "next/link";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  subtitle: string;
  date: string;
  href?: string;
  className?: string;
};

function CardInner({ title, subtitle, date }: Pick<Props, "title" | "subtitle" | "date">) {
  return (
    <>
      <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-800">
        <Calendar className="h-4 w-4 text-slate-600 dark:text-slate-300" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{title}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        <p className="mt-1 text-xs text-slate-400">{date}</p>
      </div>
    </>
  );
}

export function RecentActivityCard({ title, subtitle, date, href, className }: Props) {
  const baseClass = cn(
    "flex gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/50",
    href && "transition hover:border-violet-300 hover:shadow-sm dark:hover:border-violet-800",
    className
  );

  if (href) {
    return (
      <Link href={href} className={baseClass}>
        <CardInner title={title} subtitle={subtitle} date={date} />
      </Link>
    );
  }

  return (
    <div className={baseClass}>
      <CardInner title={title} subtitle={subtitle} date={date} />
    </div>
  );
}
