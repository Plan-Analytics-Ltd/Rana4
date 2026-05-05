/**
 * Parses the "Activities" sheet.
 */

import type { ActivityStatus } from "../../workflows/activityWorkflow.js";

export type ParsedActivityRow = {
  activityCode: string;
  activityName: string;
  fragnetName: string;
  deliverableName: string;
  bestDuration: number;
  likelyDuration: number;
  status: ActivityStatus;
  sourceExcelRow?: number;
};

const VALID_STATUS: readonly ActivityStatus[] = ["DRAFT", "PENDING_APPROVAL", "ACTIVE", "LOCKED"] as const;

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
    activity_code: "activity_code",
    activity_name: "activity_name",
    fragnet_name: "fragnet_name",
    deliverable_name: "deliverable_name",
    best_duration: "best_duration",
    likely_duration: "likely_duration",
    status: "status",
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
    !trimStr(fields.activity_code) &&
    !trimStr(fields.activity_name) &&
    !trimStr(fields.fragnet_name) &&
    !trimStr(fields.deliverable_name) &&
    !trimStr(fields.best_duration) &&
    !trimStr(fields.likely_duration) &&
    !trimStr(fields.status)
  );
}

function parsePositiveInt(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  return n;
}

function parseStatus(value: unknown, excelRow: number): ActivityStatus {
  const s = trimStr(value);
  if (!s) return "DRAFT";
  const u = s.toUpperCase() as ActivityStatus;
  if (!VALID_STATUS.includes(u)) {
    throw new Error(`Activities sheet row ${excelRow}: status must be one of ${VALID_STATUS.join(", ")}`);
  }
  return u;
}

export function parseActivitiesSheet(rows: unknown[]): ParsedActivityRow[] {
  if (!Array.isArray(rows)) throw new Error("parseActivitiesSheet: rows must be an array");

  const parsed: ParsedActivityRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    const excelRow = rowExcelNumber(i);
    if (rawRow === null || typeof rawRow !== "object") {
      throw new Error(`Activities sheet row ${excelRow}: row must be an object`);
    }
    const fields = canonFields(rawRow as Record<string, unknown>);
    if (isBlankRow(fields)) continue;

    const activityCode = trimStr(fields.activity_code);
    const activityName = trimStr(fields.activity_name);
    const fragnetName = trimStr(fields.fragnet_name);
    const deliverableName = trimStr(fields.deliverable_name);
    const bestDuration = parsePositiveInt(fields.best_duration);
    const likelyDuration = parsePositiveInt(fields.likely_duration);
    const status = parseStatus(fields.status, excelRow);

    if (!activityCode) throw new Error(`Activities sheet row ${excelRow}: activity_code is required`);
    if (!activityName) throw new Error(`Activities sheet row ${excelRow}: activity_name is required`);
    if (!fragnetName) throw new Error(`Activities sheet row ${excelRow}: fragnet_name is required`);
    if (!deliverableName) throw new Error(`Activities sheet row ${excelRow}: deliverable_name is required`);
    if (bestDuration === null || bestDuration < 1) {
      throw new Error(`Activities sheet row ${excelRow}: best_duration must be an integer >= 1`);
    }
    if (likelyDuration === null || likelyDuration < 1) {
      throw new Error(`Activities sheet row ${excelRow}: likely_duration must be an integer >= 1`);
    }

    parsed.push({
      activityCode,
      activityName,
      fragnetName,
      deliverableName,
      bestDuration,
      likelyDuration,
      status,
      sourceExcelRow: excelRow,
    });
  }

  return parsed;
}

