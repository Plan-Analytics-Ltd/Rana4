"use client";

import { cn } from "@/lib/utils";

const fieldClass =
  "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-50";

const labelClass = "text-sm font-medium text-slate-700 dark:text-slate-300";

export function FormSection(props: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-4", props.className)}>
      <div>
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{props.title}</h4>
        {props.description ? (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{props.description}</p>
        ) : null}
      </div>
      <div className="space-y-4">{props.children}</div>
    </section>
  );
}

export function FormField(props: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-2", props.className)}>
      <label htmlFor={props.htmlFor} className={labelClass}>
        {props.label}
      </label>
      {props.children}
      {props.hint ? <p className="text-xs text-slate-500 dark:text-slate-400">{props.hint}</p> : null}
    </div>
  );
}

export { fieldClass, labelClass };
