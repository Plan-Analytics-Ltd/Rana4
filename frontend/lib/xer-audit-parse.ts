/** Client-side XER table parser for internal audit viewer. */

export type XerTable = { name: string; fields: string[]; rows: string[][] };

export function parseXerTables(xerText: string): Map<string, XerTable> {
  const lines = xerText.split(/\r?\n/).filter((l) => l.length > 0);
  const tables = new Map<string, XerTable>();
  let current: string | null = null;
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts[0] === "%T") {
      current = parts[1] ?? "";
      if (current) tables.set(current, { name: current, fields: [], rows: [] });
      continue;
    }
    if (!current) continue;
    const t = tables.get(current)!;
    if (parts[0] === "%F") t.fields = parts.slice(1);
    else if (parts[0] === "%R") t.rows.push(parts.slice(1));
  }
  return tables;
}

export function fieldIndex(table: XerTable, name: string): number {
  return table.fields.indexOf(name);
}

export function orphanHighlights(tables: Map<string, XerTable>): { table: string; row: number; field: string; value: string }[] {
  const out: { table: string; row: number; field: string; value: string }[] = [];
  const task = tables.get("TASK");
  if (!task) return out;
  const taskIds = new Set(
    task.rows.map((r) => String(r[fieldIndex(task, "task_id")] ?? "").trim()).filter(Boolean)
  );
  const rsrc = tables.get("RSRC");
  const rsrcIds = rsrc
    ? new Set(rsrc.rows.map((r) => String(r[fieldIndex(rsrc, "rsrc_id")] ?? "").trim()).filter(Boolean))
    : new Set<string>();

  const taskRsrc = tables.get("TASKRSRC");
  if (taskRsrc) {
    const ti = fieldIndex(taskRsrc, "task_id");
    const ri = fieldIndex(taskRsrc, "rsrc_id");
    taskRsrc.rows.forEach((r, idx) => {
      const tid = String(r[ti] ?? "").trim();
      const rid = String(r[ri] ?? "").trim();
      if (tid && !taskIds.has(tid)) out.push({ table: "TASKRSRC", row: idx, field: "task_id", value: tid });
      if (rid && rsrcIds.size > 0 && !rsrcIds.has(rid)) out.push({ table: "TASKRSRC", row: idx, field: "rsrc_id", value: rid });
    });
  }

  const taskPred = tables.get("TASKPRED");
  if (taskPred) {
    const ti = fieldIndex(taskPred, "task_id");
    const pi = fieldIndex(taskPred, "pred_task_id");
    taskPred.rows.forEach((r, idx) => {
      const tid = String(r[ti] ?? "").trim();
      const pid = String(r[pi] ?? "").trim();
      if (tid && !taskIds.has(tid)) out.push({ table: "TASKPRED", row: idx, field: "task_id", value: tid });
      if (pid && !taskIds.has(pid)) out.push({ table: "TASKPRED", row: idx, field: "pred_task_id", value: pid });
    });
  }

  return out;
}
