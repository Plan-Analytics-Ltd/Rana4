/**
 * Parses the "Assignments" Excel sheet (header row + data rows via sheet_to_json).
 * Structural validation only — rate card checks happen in parseAndValidateAssignedResources.
 */

export type ParsedAssignmentRow = {
  level: "ACTIVITY" | "DELIVERABLE";
  fragnetName: string;
  deliverableName: string;
  activityCode?: string;
  resourceType: string;
  resourceName: string;
  units?: number;
  /** Excel row number (1-based), set for tracing import errors */
  sourceExcelRow?: number;
};

const LEVEL_ACTIVITY = "ACTIVITY";
const LEVEL_DELIVERABLE = "DELIVERABLE";

function trimStr(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeHeader(key: string): string | null {
  const k = String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const aliases: Record<string, string> = {
    level: "level",
    fragnet_name: "fragnet_name",
    deliverable_name: "deliverable_name",
    activity_code: "activity_code",
    resource_type: "resource_type",
    resource_name: "resource_name",
    units: "units",
  };
  return aliases[k] ?? null;
}

function rowExcelNumber(dataRowIndex: number): number {
  // Header is row 1; first data row is row 2.
  return dataRowIndex + 2;
}

function parseUnits(value: unknown, excelRow: number): number | undefined {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }
  const n = typeof value === "number" ? value : Number(String(value).trim().replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Assignments sheet row ${excelRow}: units must be a finite number > 0 when provided`);
  }
  return n;
}

function normalizeLevel(raw: string, excelRow: number): "ACTIVITY" | "DELIVERABLE" {
  const u = raw.trim().toUpperCase();
  if (u === LEVEL_ACTIVITY) return LEVEL_ACTIVITY;
  if (u === LEVEL_DELIVERABLE) return LEVEL_DELIVERABLE;
  throw new Error(
    `Assignments sheet row ${excelRow}: level must be "${LEVEL_ACTIVITY}" or "${LEVEL_DELIVERABLE}", got ${JSON.stringify(raw)}`
  );
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
  const level = trimStr(fields.level);
  const fragnet_name = trimStr(fields.fragnet_name);
  const deliverable_name = trimStr(fields.deliverable_name);
  const activity_code = trimStr(fields.activity_code);
  const resource_type = trimStr(fields.resource_type);
  const resource_name = trimStr(fields.resource_name);
  const units = trimStr(fields.units);
  return (
    !level &&
    !fragnet_name &&
    !deliverable_name &&
    !activity_code &&
    !resource_type &&
    !resource_name &&
    !units
  );
}

/**
 * @param rows Typically `XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false })`.
 */
export function parseAssignmentsSheet(rows: unknown[]): ParsedAssignmentRow[] {
  if (!Array.isArray(rows)) {
    throw new Error("parseAssignmentsSheet: rows must be an array");
  }

  const parsed: ParsedAssignmentRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    if (rawRow === null || typeof rawRow !== "object") {
      throw new Error(`Assignments sheet row ${rowExcelNumber(i)}: row must be an object`);
    }
    const fields = canonFields(rawRow as Record<string, unknown>);
    if (isBlankRow(fields)) continue;

    const excelRow = rowExcelNumber(i);

    const levelRaw = trimStr(fields.level);
    const fragnetName = trimStr(fields.fragnet_name);
    const deliverableName = trimStr(fields.deliverable_name);
    const activityCodeRaw = trimStr(fields.activity_code);
    const resourceType = trimStr(fields.resource_type);
    const resourceName = trimStr(fields.resource_name);

    if (!levelRaw) {
      throw new Error(`Assignments sheet row ${excelRow}: level is required`);
    }
    const level = normalizeLevel(levelRaw, excelRow);

    if (!fragnetName && level !== "DELIVERABLE") {
      throw new Error(
        `Assignments sheet row ${excelRow}: fragnet_name is required for ACTIVITY rows (leave blank only for DELIVERABLE rows on unassigned deliverables)`
      );
    }
    if (!deliverableName) {
      throw new Error(`Assignments sheet row ${excelRow}: deliverable_name is required`);
    }
    if (!resourceType) {
      throw new Error(`Assignments sheet row ${excelRow}: resource_type is required`);
    }
    if (!resourceName) {
      throw new Error(`Assignments sheet row ${excelRow}: resource_name is required`);
    }

    const units = parseUnits(fields.units, excelRow);

    if (level === LEVEL_ACTIVITY) {
      if (!activityCodeRaw) {
        throw new Error(`Assignments sheet row ${excelRow}: activity_code is required when level is ACTIVITY`);
      }
      parsed.push({
        level,
        fragnetName,
        deliverableName,
        activityCode: activityCodeRaw,
        resourceType,
        resourceName,
        sourceExcelRow: excelRow,
        ...(units !== undefined ? { units } : {}),
      });
    } else {
      parsed.push({
        level,
        fragnetName,
        deliverableName,
        resourceType,
        resourceName,
        sourceExcelRow: excelRow,
        ...(units !== undefined ? { units } : {}),
      });
    }
  }

  return parsed;
}
