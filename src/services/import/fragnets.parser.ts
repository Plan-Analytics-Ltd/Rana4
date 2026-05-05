/**
 * Parses the "Fragnets" sheet.
 */

export type ParsedFragnetRow = {
  fragnetName: string;
  standardName: string;
  description?: string;
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
    fragnet_name: "fragnet_name",
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
  return (
    !trimStr(fields.fragnet_name) &&
    !trimStr(fields.standard_name) &&
    !trimStr(fields.description)
  );
}

export function parseFragnetsSheet(rows: unknown[]): ParsedFragnetRow[] {
  if (!Array.isArray(rows)) throw new Error("parseFragnetsSheet: rows must be an array");

  const parsed: ParsedFragnetRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    const excelRow = rowExcelNumber(i);
    if (rawRow === null || typeof rawRow !== "object") {
      throw new Error(`Fragnets sheet row ${excelRow}: row must be an object`);
    }
    const fields = canonFields(rawRow as Record<string, unknown>);
    if (isBlankRow(fields)) continue;

    const fragnetName = trimStr(fields.fragnet_name);
    const standardName = trimStr(fields.standard_name);
    const description = trimStr(fields.description);

    if (!fragnetName) throw new Error(`Fragnets sheet row ${excelRow}: fragnet_name is required`);
    if (!standardName) throw new Error(`Fragnets sheet row ${excelRow}: standard_name is required`);

    parsed.push({
      fragnetName,
      standardName,
      ...(description ? { description } : {}),
      sourceExcelRow: excelRow,
    });
  }

  return parsed;
}

