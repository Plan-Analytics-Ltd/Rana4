import * as XLSX from "xlsx";

export type RateCardEntry = {
  resourceType: string;
  resourceName: string;
  unit: string;
  rate: number;
};

function normalizeHeaderKey(key: string): keyof RateCardEntry | null {
  const s = String(key).trim().toLowerCase().replace(/\s+/g, " ");
  if (s === "resource type" || s === "type" || s === "resourcetype" || s === "category") return "resourceType";
  if (s === "resource name" || s === "name" || s === "resourcename" || s === "role") return "resourceName";
  if (s === "unit" || s === "units" || s === "uom") return "unit";
  if (s === "rate" || s === "price" || s === "price/unit" || s === "price per unit" || s === "cost rate") return "rate";
  return null;
}

function parseRate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).trim().replace(/^£/, "").replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse first sheet of CSV or Excel. Expects headers like:
 * Resource Type | Resource Name | Unit | Rate
 */
export function parseRateCardSpreadsheet(buffer: Buffer): { ok: true; entries: RateCardEntry[] } | { ok: false; error: string } {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, error: "Could not read file. Use .csv or .xlsx." };
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { ok: false, error: "No sheet found in file." };
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  if (rows.length === 0) {
    return { ok: false, error: "File has no data rows." };
  }

  const entries: RateCardEntry[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const draft: Partial<Record<keyof RateCardEntry, string | number>> = {};
    for (const [k, v] of Object.entries(row)) {
      const canon = normalizeHeaderKey(k);
      if (!canon) continue;
      if (canon === "rate") {
        const r = parseRate(v);
        if (r !== null) draft.rate = r;
      } else {
        draft[canon] = String(v).trim();
      }
    }

    const resourceType = draft.resourceType as string | undefined;
    const resourceName = draft.resourceName as string | undefined;
    const unit = draft.unit as string | undefined;
    const rate = draft.rate as number | undefined;

    if (!resourceType && !resourceName && (unit === undefined || unit === "") && rate === undefined) {
      continue;
    }
    if (!resourceType || !resourceName || !unit || rate === undefined || rate === null) {
      return {
        ok: false,
        error: `Row ${i + 2}: each data row needs Resource Type, Resource Name, Unit, and Rate (see header names).`,
      };
    }
    if (rate <= 0 || !Number.isFinite(rate)) {
      return { ok: false, error: `Row ${i + 2}: rate must be a positive number.` };
    }

    const key = `${resourceType.toLowerCase()}|${resourceName.toLowerCase()}`;
    if (seen.has(key)) {
      return { ok: false, error: `Duplicate resource: ${resourceType} / ${resourceName}` };
    }
    seen.add(key);

    entries.push({
      resourceType,
      resourceName,
      unit,
      rate,
    });
  }

  if (entries.length === 0) return { ok: false, error: "No valid rows found after headers." };
  if (entries.length > 500) return { ok: false, error: "Maximum 500 rate card rows per upload." };

  return { ok: true, entries };
}
