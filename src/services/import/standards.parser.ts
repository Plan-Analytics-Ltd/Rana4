/**
 * Parses the "Standards" sheet (header row + data rows via sheet_to_json).
 * Structural validation only (required fields, duplicates).
 */

export type ParsedStandardRow = {
  standardName: string;
  description?: string;
  sourceExcelRow?: number;
};

function trimStr(value: unknown): string {
  return String(value ?? "").trim();
}

function rowExcelNumber(dataRowIndex: number): number {
  // Header is row 1; first data row is row 2.
  return dataRowIndex + 2;
}

function normalizeHeader(key: string): string | null {
  const k = String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const aliases: Record<string, string> = {
    standard_name: "standard_name",
    description: "description",
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
  const standard_name = trimStr(fields.standard_name);
  const description = trimStr(fields.description);
  return !standard_name && !description;
}

export function parseStandardsSheet(rows: unknown[]): ParsedStandardRow[] {
  if (!Array.isArray(rows)) throw new Error("parseStandardsSheet: rows must be an array");

  const parsed: ParsedStandardRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    const excelRow = rowExcelNumber(i);
    if (rawRow === null || typeof rawRow !== "object") {
      throw new Error(`Standards sheet row ${excelRow}: row must be an object`);
    }
    const fields = canonFields(rawRow as Record<string, unknown>);
    if (isBlankRow(fields)) continue;

    const standardName = trimStr(fields.standard_name);
    const description = trimStr(fields.description);

    if (!standardName) {
      throw new Error(`Standards sheet row ${excelRow}: standard_name is required`);
    }

    parsed.push({
      standardName,
      ...(description ? { description } : {}),
      sourceExcelRow: excelRow,
    });
  }

  return parsed;
}

