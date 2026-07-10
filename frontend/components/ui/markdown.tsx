"use client";

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
/**
 * Shared, XSS-safe Markdown renderer.
 *
 * react-markdown does not render raw HTML unless the `rehype-raw` plugin is
 * supplied, so any HTML embedded in the source is escaped and shown as text.
 * This keeps rendered assistant responses safe from injection while still
 * supporting standard Markdown emphasis, lists, and inline code.
 */
const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="whitespace-pre-wrap leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code: ({ children }) => (
    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800 dark:bg-slate-800 dark:text-slate-100">
      {children}
    </code>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-violet-600 underline underline-offset-2 hover:text-violet-700 dark:text-violet-400"
    >
      {children}
    </a>
  ),
  h1: ({ children }) => <h1 className="mt-3 text-base font-semibold text-slate-900 first:mt-0 dark:text-white">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 text-sm font-semibold text-slate-900 first:mt-0 dark:text-white">{children}</h2>,
  h3: ({ children }) => (
    <h3 className="mt-3 text-sm font-semibold uppercase tracking-wide text-slate-600 first:mt-0 dark:text-slate-300">
      {children}
    </h3>
  ),};

type MarkdownProps = {
  content: string;
  className?: string;
};

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn("space-y-2 [&>*:first-child]:mt-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}