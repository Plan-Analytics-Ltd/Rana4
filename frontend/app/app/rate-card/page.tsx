"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Upload, Table } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { rateCardApi, getApiErrorMessage, type RateCardEntry } from "@/lib/api";
import { useProject } from "@/contexts/project-context";
import { hasPermission } from "@/lib/project-permissions";

export default function RateCardPage() {
  const { selectedProjectId, selectedProjectRole } = useProject();
  const mayAdmin = hasPermission(selectedProjectRole, "rateCard", "update");
  const [entries, setEntries] = useState<RateCardEntry[]>([]);
  const [summary, setSummary] = useState<{ type: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await rateCardApi.get();
      setEntries(data.entries);
      setSummary(data.summary);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load rate card");
      setEntries([]);
      setSummary([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      toast.error("Please choose a .csv or .xlsx file");
      return;
    }
    setUploading(true);
    try {
      const { data } = await rateCardApi.upload(file, selectedProjectId ?? undefined);
      toast.success(data.message ?? `Uploaded ${data.count} rows`);
      await load();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onClear = async () => {
    if (entries.length === 0) return;
    if (
      !confirm(
        "Remove the entire rate card? Saved activities and deliverables keep their assignment rows, but you will need a new upload before those assignments validate again."
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      const { data } = await rateCardApi.clear(selectedProjectId ?? undefined);
      toast.success(data.message ?? "Rate card removed");
      await load();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Could not remove rate card");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Rate card</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Upload a spreadsheet to define resource types, names, units, and rates. Each upload replaces the previous card.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-5 w-5" /> Upload file
          </CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            First row must be headers, e.g. <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">Resource Type</code>,{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">Resource Name</code>,{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">Unit</code>,{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">Rate</code>. Up to 500 rows.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {mayAdmin ? (
            <Button variant="outline" disabled={uploading || clearing} asChild>
              <label className="cursor-pointer">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                <span className="ml-2">{uploading ? "Uploading…" : "Choose CSV or Excel"}</span>
                <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={onFile} disabled={uploading || clearing} />
              </label>
            </Button>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              You do not have permission to upload or clear the rate card.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Table className="h-5 w-5" /> Current entries ({entries.length})
          </CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {summary.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                By type: {summary.map((s) => `${s.type} (${s.count})`).join(" · ")}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 border-red-200 text-red-700 hover:bg-red-50 sm:ml-auto dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              disabled={!mayAdmin || loading || entries.length === 0 || clearing || uploading}
              onClick={onClear}
            >
              {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              <span className="ml-2">{clearing ? "Removing…" : "Remove rate card"}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No rate card yet. Upload a file above before assigning resources to activities or deliverables.
            </p>
          ) : (
            <div className="max-h-[420px] overflow-auto rounded-md border border-slate-200 dark:border-slate-700">
              <UITable>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((r, i) => (
                    <TableRow key={`${r.resourceType}-${r.resourceName}-${i}`}>
                      <TableCell className="font-medium">{r.resourceType}</TableCell>
                      <TableCell>{r.resourceName}</TableCell>
                      <TableCell>{r.unit}</TableCell>
                      <TableCell className="text-right">£{r.rate}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </UITable>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
