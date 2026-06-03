/**
 * Parses the "Deliverables" sheet.
 */

export type ParsedDeliverableRow = {
  deliverableName: string;
  /** Empty / missing in Excel → unassigned deliverable (no fragnet). */
  fragnetName: string | null;
  bestDuration: number;
  likelyDuration: number;
  externalProjectId?: string | null;
  sourceExcelRow?: number;
};

function trimStr(value: unknown): string {
  return String(value ?? "").trim();
}

function rowExcelNumber(dataRowIndex: number): number {
  return dataRowIndex + 2;
}

function normalizeHeader(key: string): string | null {
  const k = String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const aliases: Record<string, string> = {
    deliverable_name: "deliverable_name",
    fragnet_name: "fragnet_name",
    best_duration: "best_duration",
    likely_duration: "likely_duration",
    external_project_id: "external_project_id",
  };
  return aliases[k] ?? null;
}

function canonFields(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const nk = normalizeHeader(k);
    if (nk) out[nk] = v;
  }
  return out;
}

function isBlankRow(fields: Record<string, unknown>): boolean {
  return (
    !trimStr(fields.deliverable_name) &&
    !trimStr(fields.fragnet_name) &&
    !trimStr(fields.best_duration) &&
    !trimStr(fields.likely_duration) &&
    !trimStr(fields.external_project_id)
  );
}

function parsePositiveInt(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  return n;
}

export function parseDeliverablesSheet(rows: unknown[]): ParsedDeliverableRow[] {
  if (!Array.isArray(rows)) throw new Error("parseDeliverablesSheet: rows must be an array");

  const parsed: ParsedDeliverableRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    const excelRow = rowExcelNumber(i);
    if (rawRow === null || typeof rawRow !== "object") {
      throw new Error(`Deliverables sheet row ${excelRow}: row must be an object`);
    }
    const fields = canonFields(rawRow as Record<string, unknown>);
    if (isBlankRow(fields)) continue;

    const deliverableName = trimStr(fields.deliverable_name);
    const fragnetNameRaw = trimStr(fields.fragnet_name);
    const fragnetName = fragnetNameRaw === "" ? null : fragnetNameRaw;
    const bestDuration = parsePositiveInt(fields.best_duration);
    const likelyDuration = parsePositiveInt(fields.likely_duration);
    const externalProjectIdRaw = trimStr(fields.external_project_id);

    if (!deliverableName) throw new Error(`Deliverables sheet row ${excelRow}: deliverable_name is required`);
    if (bestDuration === null || bestDuration < 1) {
      throw new Error(`Deliverables sheet row ${excelRow}: best_duration must be an integer >= 1`);
    }
    if (likelyDuration === null || likelyDuration < 1) {
      throw new Error(`Deliverables sheet row ${excelRow}: likely_duration must be an integer >= 1`);
    }

    parsed.push({
      deliverableName,
      fragnetName,
      bestDuration,
      likelyDuration,
      externalProjectId: externalProjectIdRaw ? externalProjectIdRaw : null,
      sourceExcelRow: excelRow,
    });
  }

  return parsed;
}

