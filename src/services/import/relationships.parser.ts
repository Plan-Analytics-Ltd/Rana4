/**
 * Parses the "Relationships" Excel sheet.
 */

export type ParsedRelationshipRow = {
  fragnetName: string;
  predecessorCode: string;
  successorCode: string;
  relationshipType: "FS" | "SS" | "FF" | "SF";
  lag: number;
  sourceExcelRow?: number;
};

const ALLOWED_TYPES = ["FS", "SS", "FF", "SF"] as const;

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
    predecessor_activity_code: "predecessor_activity_code",
    successor_activity_code: "successor_activity_code",
    relationship_type: "relationship_type",
    lag: "lag",
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
    !trimStr(fields.predecessor_activity_code) &&
    !trimStr(fields.successor_activity_code) &&
    !trimStr(fields.relationship_type) &&
    !trimStr(fields.lag)
  );
}

function parseLag(raw: unknown, rowNumber: number): number {
  if (raw === undefined || raw === null || String(raw).trim() === "") return 0;

  const str = String(raw).trim().toLowerCase();
  // remove units like "d", "day", "days"
  const cleaned = str.replace(/\s*(days?|d)$/i, "").trim();
  const value = Number(cleaned);

  if (!Number.isFinite(value)) {
    throw new Error(`Row ${rowNumber}: Invalid lag value ${JSON.stringify(String(raw))}`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`Row ${rowNumber}: Lag must be an integer, got ${JSON.stringify(String(raw))}`);
  }
  return value;
}

function parseType(value: unknown, excelRow: number): ParsedRelationshipRow["relationshipType"] {
  const raw = trimStr(value);
  const u = raw.toUpperCase();
  if (!ALLOWED_TYPES.includes(u as any)) {
    throw new Error(
      `Relationships sheet row ${excelRow}: Invalid relationship_type ${JSON.stringify(raw)} (allowed: FS, SS, FF, SF)`
    );
  }
  return u as ParsedRelationshipRow["relationshipType"];
}

export function parseRelationshipsSheet(rows: unknown[]): ParsedRelationshipRow[] {
  if (!Array.isArray(rows)) throw new Error("parseRelationshipsSheet: rows must be an array");

  const parsed: ParsedRelationshipRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    const excelRow = rowExcelNumber(i);
    if (rawRow === null || typeof rawRow !== "object") {
      throw new Error(`Relationships sheet row ${excelRow}: row must be an object`);
    }
    const fields = canonFields(rawRow as Record<string, unknown>);
    if (isBlankRow(fields)) continue;

    const fragnetName = trimStr(fields.fragnet_name);
    const predecessorCode = trimStr(fields.predecessor_activity_code);
    const successorCode = trimStr(fields.successor_activity_code);
    const relationshipType = parseType(fields.relationship_type, excelRow);
    const lag = parseLag(fields.lag, excelRow);

    if (!fragnetName) throw new Error(`Relationships sheet row ${excelRow}: fragnet_name is required`);
    if (!predecessorCode)
      throw new Error(`Relationships sheet row ${excelRow}: predecessor_activity_code is required`);
    if (!successorCode) throw new Error(`Relationships sheet row ${excelRow}: successor_activity_code is required`);

    parsed.push({
      fragnetName,
      predecessorCode,
      successorCode,
      relationshipType,
      lag,
      sourceExcelRow: excelRow,
    });
  }

  return parsed;
}

