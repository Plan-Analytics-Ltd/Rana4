"use client";

import { useMemo, useState } from "react";
import { FileSearch, Upload, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { parseXerTables, orphanHighlights, type XerTable } from "@/lib/xer-audit-parse";
import { cn } from "@/lib/utils";

const AUDIT_TABLES = ["TASK", "TASKPRED", "TASKRSRC", "ACTVCODE", "RSRC", "RSRCRATE", "ACTVTYPE", "PROJECT", "PROJWBS"];

export default function XerAuditPage() {
  const [xerText, setXerText] = useState("");
  const [tableName, setTableName] = useState("TASK");
  const [search, setSearch] = useState("");
  const [fileLabel, setFileLabel] = useState<string | null>(null);

  const tables = useMemo(() => (xerText.trim() ? parseXerTables(xerText) : new Map<string, XerTable>()), [xerText]);

  const orphans = useMemo(() => orphanHighlights(tables), [tables]);

  const availableTables = useMemo(() => {
    const names = [...tables.keys()].filter((n) => AUDIT_TABLES.includes(n) || n.startsWith("TASK"));
    return names.length > 0 ? names.sort() : AUDIT_TABLES;
  }, [tables]);

  const activeTable = tables.get(tableName);

  const orphanRows = useMemo(() => {
    const set = new Set(orphans.filter((o) => o.table === tableName).map((o) => o.row));
    return set;
  }, [orphans, tableName]);

  const filteredRows = useMemo(() => {
    if (!activeTable) return [];
    const q = search.trim().toLowerCase();
    if (!q) return activeTable.rows.map((row, idx) => ({ row, idx }));
    return activeTable.rows
      .map((row, idx) => ({ row, idx }))
      .filter(({ row }) => row.some((cell) => String(cell ?? "").toLowerCase().includes(q)));
  }, [activeTable, search]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setXerText(text);
    setFileLabel(file.name);
    const parsed = parseXerTables(text);
    const first = AUDIT_TABLES.find((t) => parsed.has(t)) ?? [...parsed.keys()][0];
    if (first) setTableName(first);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">XER audit viewer</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Inspect generated P6 tables without Primavera. Upload a .xer file or paste content. Orphan and broken references are highlighted.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" />
            Load XER
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="file"
              accept=".xer,.txt"
              className="max-w-xs"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            {fileLabel && <span className="text-sm text-slate-500">{fileLabel}</span>}
          </div>
          <textarea
            value={xerText}
            onChange={(e) => setXerText(e.target.value)}
            placeholder="Or paste XER tab-delimited content here…"
            className="min-h-[120px] w-full rounded-md border border-slate-200 bg-white p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => { setXerText(""); setFileLabel(null); }}>
            Clear
          </Button>
        </CardContent>
      </Card>

      {xerText.trim() && (
        <>
          {orphans.length > 0 && (
            <Card className="border-amber-200 dark:border-amber-900/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-amber-800 dark:text-amber-200">
                  <AlertCircle className="h-4 w-4" />
                  Reference issues ({orphans.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-amber-900 dark:text-amber-100">
                  {orphans.slice(0, 50).map((o, i) => (
                    <li key={`${o.table}-${o.row}-${i}`}>
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        onClick={() => setTableName(o.table)}
                      >
                        {o.table} row {o.row + 1}: {o.field} = {o.value}
                      </button>
                    </li>
                  ))}
                  {orphans.length > 50 && <li className="text-xs opacity-70">…and {orphans.length - 50} more</li>}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap gap-4">
            <Card className="min-w-[200px] shrink-0">
              <CardHeader>
                <CardTitle className="text-sm">Tables</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="text-sm">
                  {availableTables.map((name) => {
                    const t = tables.get(name);
                    const count = t?.rows.length ?? 0;
                    const hasOrphan = orphans.some((o) => o.table === name);
                    return (
                      <li key={name}>
                        <button
                          type="button"
                          onClick={() => setTableName(name)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 px-4 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800",
                            tableName === name && "bg-cyan-50 font-medium dark:bg-cyan-950/30"
                          )}
                        >
                          <span>{name}</span>
                          <span className="text-xs text-slate-500">
                            {count}
                            {hasOrphan && " ⚠"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>

            <Card className="min-w-0 flex-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileSearch className="h-4 w-4" />
                  {tableName}
                  {activeTable ? ` (${filteredRows.length} / ${activeTable.rows.length} rows)` : " — not in file"}
                </CardTitle>
                <Input
                  placeholder="Search rows…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-sm"
                />
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {!activeTable ? (
                  <p className="text-sm text-slate-500">Table not present in this XER.</p>
                ) : (
                  <table className="w-full min-w-[640px] border-collapse text-left text-xs font-mono">
                    <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800">
                      <tr>
                        <th className="border border-slate-200 px-2 py-1 dark:border-slate-700">#</th>
                        {activeTable.fields.map((f) => (
                          <th key={f} className="border border-slate-200 px-2 py-1 whitespace-nowrap dark:border-slate-700">
                            {f}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.slice(0, 500).map(({ row, idx }) => (
                        <tr
                          key={idx}
                          className={cn(
                            orphanRows.has(idx) && "bg-red-50 dark:bg-red-950/30"
                          )}
                        >
                          <td className="border border-slate-200 px-2 py-0.5 text-slate-500 dark:border-slate-700">
                            {idx + 1}
                          </td>
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className="max-w-[200px] truncate border border-slate-200 px-2 py-0.5 dark:border-slate-700"
                              title={String(cell ?? "")}
                            >
                              {String(cell ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {activeTable && filteredRows.length > 500 && (
                  <p className="mt-2 text-xs text-slate-500">Showing first 500 matching rows.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
