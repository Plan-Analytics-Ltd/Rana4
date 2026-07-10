"use client";

import type {
  AskRanaHighlightedRevision,
  AskRanaResponse,
  AskRanaTimelineStep,
} from "@/lib/ask-rana-orchestration";
import { cn } from "@/lib/utils";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {children}
    </div>
  );
}

function TimelineList({
  steps,
  compact = false,
  highlightLabels,
}: {
  steps: AskRanaTimelineStep[];
  compact?: boolean;
  highlightLabels?: Set<string>;
}) {
  return (
    <ol className="relative space-y-0">
      {steps.map((step, index) => {
        const highlighted = highlightLabels?.has(step.label);
        return (
          <li key={`${step.label}-${step.importedAt}-${index}`} className="relative flex gap-3 pb-3 last:pb-0">
            {index < steps.length - 1 ? (
              <span
                className="absolute left-[7px] top-4 h-[calc(100%-4px)] w-px bg-violet-200 dark:bg-violet-800"
                aria-hidden
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 bg-white dark:bg-slate-900",
                highlighted
                  ? "border-amber-500 dark:border-amber-400"
                  : index === 0
                    ? "border-emerald-500 dark:border-emerald-400"
                    : index === steps.length - 1 && steps.length > 1
                      ? "border-violet-600 dark:border-violet-300"
                      : "border-violet-400 dark:border-violet-500"
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className={cn(
                    "font-medium",
                    highlighted ? "text-amber-800 dark:text-amber-200" : "text-slate-900 dark:text-white"
                  )}
                >
                  {step.label}
                </span>
                <span className="text-xs text-slate-500">{step.role}</span>
                {highlighted ? (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    Key revision
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">
                {step.durationDays != null ? `${step.durationDays} days` : "—"}
                {step.durationChangeDays != null && step.durationChangeDays !== 0 ? (
                  <span className="ml-1.5 text-xs text-slate-500">
                    ({step.durationChangeDays > 0 ? "+" : ""}
                    {step.durationChangeDays})
                  </span>
                ) : null}
              </div>
              {!compact ? (
                <div className="text-xs text-slate-400">
                  Imported {new Date(step.importedAt).toLocaleDateString()}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function HighlightedRevisionList({ items }: { items: AskRanaHighlightedRevision[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={`${item.label}-${item.highlightReason}`}
          className="rounded-md border border-amber-200/80 bg-amber-50/50 px-2.5 py-2 dark:border-amber-900/40 dark:bg-amber-950/20"
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-slate-900 dark:text-white">{item.label}</span>
            <span className="text-xs text-slate-500">{item.role}</span>
          </div>
          <div className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">
            {item.durationDays} days
            {item.durationChangeDays != null && item.durationChangeDays !== 0 ? (
              <span className="ml-1.5 text-xs text-slate-500">
                ({item.durationChangeDays > 0 ? "+" : ""}
                {item.durationChangeDays})
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">{item.highlightReason}</div>
        </li>
      ))}
    </ul>
  );
}

function BubbleShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-violet-200/80 bg-white px-3 py-2.5 text-sm dark:border-violet-900/40 dark:bg-slate-900/60">
      {children}
    </div>
  );
}

export function AskRanaResponseBubble({ response }: { response: AskRanaResponse }) {
  switch (response.layout) {
    case "what_changed":
      return (
        <BubbleShell>
          <div>
            <SectionLabel>Summary</SectionLabel>
            <p className="mt-0.5 text-slate-800 dark:text-slate-100">{response.summary}</p>
          </div>
          {response.netChange ? (
            <div>
              <SectionLabel>Net change</SectionLabel>
              <p className="mt-0.5 text-slate-700 dark:text-slate-200">{response.netChange}</p>
            </div>
          ) : null}
          {response.timelineHighlights.length > 0 ? (
            <div>
              <SectionLabel>Timeline highlights</SectionLabel>
              <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-200">
                {response.timelineHighlights.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {response.highlightedRevisions.length > 0 ? (
            <div>
              <SectionLabel>Key revisions</SectionLabel>
              <div className="mt-1.5">
                <HighlightedRevisionList items={response.highlightedRevisions} />
              </div>
            </div>
          ) : null}
          <div>
            <SectionLabel>Latest state</SectionLabel>
            <p className="mt-0.5 text-slate-700 dark:text-slate-200">{response.latestState}</p>
          </div>
        </BubbleShell>
      );

    case "revision_history":
      return (
        <BubbleShell>
          <TimelineList steps={response.timeline} />
        </BubbleShell>
      );

    case "why_changed":
      return (
        <BubbleShell>
          <div>
            <SectionLabel>How it changed</SectionLabel>
            <p className="mt-0.5 text-slate-800 dark:text-slate-100">{response.howChanged}</p>
          </div>
          {response.changePattern ? (
            <div>
              <SectionLabel>Change pattern</SectionLabel>
              <p className="mt-0.5 text-slate-700 dark:text-slate-200">{response.changePattern}</p>
            </div>
          ) : null}
          {response.keySteps.length > 0 ? (
            <div>
              <SectionLabel>Key steps</SectionLabel>
              <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-200">
                {response.keySteps.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </BubbleShell>
      );

    case "which_revision_changed":
      return (
        <BubbleShell>
          <div>
            <SectionLabel>Answer</SectionLabel>
            <p className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">{response.answer}</p>
          </div>
          {response.largestIncrease ? (
            <div>
              <SectionLabel>Largest increase</SectionLabel>
              <p className="mt-0.5 text-slate-700 dark:text-slate-200">{response.largestIncrease}</p>
            </div>
          ) : null}
          {response.largestReduction ? (
            <div>
              <SectionLabel>Largest reduction</SectionLabel>
              <p className="mt-0.5 text-slate-700 dark:text-slate-200">{response.largestReduction}</p>
            </div>
          ) : null}
          {response.highlights.length > 0 ? (
            <div>
              <SectionLabel>Revision highlights</SectionLabel>
              <div className="mt-1.5">
                <HighlightedRevisionList items={response.highlights} />
              </div>
            </div>
          ) : null}
        </BubbleShell>
      );

    case "stability_assessment":
      return (
        <BubbleShell>
          <div>
            <SectionLabel>Answer</SectionLabel>
            <p className="mt-0.5 text-slate-800 dark:text-slate-100">{response.answer}</p>
          </div>
          <div>
            <SectionLabel>Trend</SectionLabel>
            <p className="mt-0.5 text-slate-700 dark:text-slate-200">{response.trend}</p>
          </div>
          {response.volatility ? (
            <div>
              <SectionLabel>Volatility</SectionLabel>
              <p className="mt-0.5 text-slate-700 dark:text-slate-200">{response.volatility}</p>
            </div>
          ) : null}
          {response.stablePeriods.length > 0 ? (
            <div>
              <SectionLabel>Stable periods</SectionLabel>
              <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-200">
                {response.stablePeriods.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </BubbleShell>
      );

    case "evolution_summary":
      return (
        <BubbleShell>
          <div>
            <SectionLabel>Summary</SectionLabel>
            <p className="mt-0.5 text-slate-800 dark:text-slate-100">{response.summary}</p>
          </div>
          <div>
            <SectionLabel>Trend</SectionLabel>
            <p className="mt-0.5 text-slate-700 dark:text-slate-200">{response.trend}</p>
          </div>
          {response.highlights.length > 0 ? (
            <div>
              <SectionLabel>Highlights</SectionLabel>
              <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-200">
                {response.highlights.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {response.observations.length > 0 ? (
            <div>
              <SectionLabel>Observations</SectionLabel>
              <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-200">
                {response.observations.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </BubbleShell>
      );

    case "duration_reasonable":
      return (
        <BubbleShell>
          <div>
            <SectionLabel>Answer</SectionLabel>
            <p className="mt-0.5 text-slate-800 dark:text-slate-100">{response.answer}</p>
          </div>
          <div>
            <SectionLabel>Comparison with previous projects</SectionLabel>
            <p className="mt-0.5 text-slate-700 dark:text-slate-200">{response.comparison}</p>
          </div>
          <div>
            <SectionLabel>Evidence</SectionLabel>
            <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-200">
              {response.evidence.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <SectionLabel>Recommendation</SectionLabel>
            <p className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">{response.recommendation}</p>
          </div>
        </BubbleShell>
      );

    case "explain_combined":
      return (
        <BubbleShell>
          <p className="text-slate-800 dark:text-slate-100">{response.summary}</p>
          <div>
            <SectionLabel>{response.previousProjects.heading}</SectionLabel>
            <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-200">
              {response.previousProjects.points.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <SectionLabel>{response.projectEvolution.heading}</SectionLabel>
            <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-200">
              {response.projectEvolution.points.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <SectionLabel>What to do next</SectionLabel>
            <p className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">{response.recommendation}</p>
          </div>
        </BubbleShell>
      );

    case "what_to_do":
      return (
        <BubbleShell>
          <div>
            <SectionLabel>Answer</SectionLabel>
            <p className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">{response.answer}</p>
          </div>
          {response.steps.length > 0 ? (
            <div>
              <SectionLabel>Also consider</SectionLabel>
              <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-200">
                {response.steps.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </BubbleShell>
      );

    case "compare_reference":
      return (
        <BubbleShell>
          <div>
            <SectionLabel>Answer</SectionLabel>
            <p className="mt-0.5 text-slate-800 dark:text-slate-100">{response.answer}</p>
          </div>
          <div>
            <SectionLabel>Compared against</SectionLabel>
            <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-200">
              {response.comparedAgainst.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <SectionLabel>Evidence</SectionLabel>
            <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-200">
              {response.evidence.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        </BubbleShell>
      );

    case "standard":
    default:
      return (
        <BubbleShell>
          <div>
            <SectionLabel>Answer</SectionLabel>
            <p className="mt-0.5 text-slate-800 dark:text-slate-100">{response.answer}</p>
          </div>
          <div>
            <SectionLabel>Why</SectionLabel>
            <p className="mt-0.5 text-slate-700 dark:text-slate-200">{response.why}</p>
          </div>
          <div>
            <SectionLabel>Evidence</SectionLabel>
            <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-200">
              {response.evidence.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <SectionLabel>What to do next</SectionLabel>
            <p className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">{response.action}</p>
          </div>
        </BubbleShell>
      );
  }
}
