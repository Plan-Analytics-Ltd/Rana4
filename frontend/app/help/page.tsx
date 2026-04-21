import Link from "next/link";
import { HelpAccordion } from "@/components/help/HelpAccordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const helpItems = [
  {
    id: "what-is-rana4",
    title: "What is Rana4?",
    content: (
      <p>
        Rana4 is a structured scheduling platform that lets you define standards, build fragment networks (fragnets), model activities with dual durations (best and likely), and export deterministic schedules. It is designed for programme and project control where consistency and traceability matter.
      </p>
    ),
  },
  {
    id: "what-is-fragnet",
    title: "What is a Fragnet?",
    content: (
      <p>
        A fragnet (fragment network) is a set of activities and relationships that belong to a single standard. You create fragnets per standard, add activities with codes and durations, and link them with predecessor-successor relationships (FS, SS, FF, SF). Fragnets are the unit of export: you choose a fragnet and a duration scenario to generate an Excel file with TASK, TASKPRED, and TASKRSRC sheets. If you have uploaded a rate card, the workbook also includes an <strong>RSRC</strong> sheet (resource definitions in Primavera layout).
      </p>
    ),
  },
  {
    id: "best-vs-likely",
    title: "Best vs Likely Duration",
    content: (
      <p>
        Each activity has two duration fields: <strong>best</strong> and <strong>likely</strong>. When you export, you choose a scenario: &quot;best&quot; uses the best duration for every activity in the export; &quot;likely&quot; uses the likely duration. This supports dual-duration modelling for risk and scenario analysis without changing the structure of the schedule.
      </p>
    ),
  },
  {
    id: "export-overview",
    title: "Export Process Overview",
    content: (
      <p>
        Go to <strong>Export</strong> in the app, select a standard and then a fragnet, and choose the scenario (best or likely). Click &quot;Download Excel&quot; to get a single .xlsx file with <strong>TASK</strong> (activities), <strong>TASKPRED</strong> (relationships), <strong>TASKRSRC</strong> (resource assignments), and—when a rate card is present—<strong>RSRC</strong> (resource ID, name, type, unit, default units/time, rate). Activity IDs in the export are deterministically mapped (e.g. A1000, A1001) so the same fragnet always produces the same IDs.
      </p>
    ),
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Help & Documentation
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Learn how Rana4 works and how to use the platform.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/app">Back to platform</Link>
        </Button>
      </div>

      <Card className="dark:border-slate-800 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-base">Documentation</CardTitle>
        </CardHeader>
        <CardContent>
          <HelpAccordion items={helpItems} />
        </CardContent>
      </Card>
    </div>
  );
}
