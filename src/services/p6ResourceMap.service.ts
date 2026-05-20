import type { RateCardEntry } from "./rateCard.js";
import { compareResourcesForP6Order } from "./p6ResourceSort.js";
import {
  p6DeterministicRsrcId,
  p6DeterministicRsrcRateId,
  p6DeterministicRsrcSeqNum,
} from "./p6DeterministicId.service.js";

export type P6Resource = {
  rsrc_id: number;
  rsrc_seq_num: number;
  rsrc_rate_id: number;
  rsrc_name: string;
  rsrc_short_name: string;
  cost_per_qty: number;
  /** P6 RSRC.rsrc_type */
  rsrc_type: string;
  /** P6 cost_qty_type (QT_Hour / QT_Day / …) */
  cost_qty_type: string;
  /** Original spreadsheet / rate-card unit label */
  unit: string;
};

export type BuildP6ResourceMapOpts = {
  /** Namespace for stable RSRC / RSRCRATE ids (must match XER `xerDeterministicScope` for TASKRSRC joins). */
  deterministicScope: string;
  /** RSRCRATE row start_date (YYYY-MM-DD); included in deterministic rate id. */
  rateStartDate?: string | null;
};

function norm(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

function key(type: string, name: string): string {
  return `${norm(type)}|${norm(name)}`;
}

function inferRsrcType(resourceType: string): string {
  const t = norm(resourceType);
  if (t.includes("material") || t === "mat" || t.includes("consumable")) return "RT_Mat";
  return "RT_Labor";
}

function inferCostQtyType(unit: string): string {
  const u = norm(unit).replace(/\./g, "");
  if (u === "d" || u === "day" || u === "days" || u === "dy") return "QT_Day";
  if (u === "h" || u === "hr" || u === "hour" || u === "hours") return "QT_Hour";
  return "QT_Hour";
}

/**
 * Rate card → P6 RSRC / RSRCRATE rows with deterministic ids (stable across exports for the same scope).
 */
export function buildP6ResourceMap(
  entries: RateCardEntry[],
  opts?: BuildP6ResourceMapOpts | null
): {
  resources: P6Resource[];
  byTypeName: Map<string, P6Resource>;
  byShortName: Map<string, P6Resource>;
} {
  const scope = String(opts?.deterministicScope ?? "default-scope").trim() || "default-scope";
  const rateStart = String(opts?.rateStartDate ?? "2026-01-01").trim() || "2026-01-01";

  const sorted = [...entries].sort(compareResourcesForP6Order);

  const resources: P6Resource[] = [];
  const byTypeName = new Map<string, P6Resource>();
  const byShortName = new Map<string, P6Resource>();
  const shortNames = new Set<string>();

  for (const e of sorted) {
    const rsrc_name = String(e.resourceName ?? "").trim();
    const cost_per_qty = Number(e.rate);

    if (!rsrc_name) {
      throw new Error("rate card: resourceName is required for P6 rsrc_name");
    }
    if (!Number.isFinite(cost_per_qty) || cost_per_qty < 0) {
      throw new Error("rate card: invalid rate");
    }

    const rsrc_short_name = String(e.rsrcShortName ?? "").trim();
    if (!rsrc_short_name) {
      throw new Error("rate card: missing rsrcShortName");
    }
    if (shortNames.has(rsrc_short_name)) {
      throw new Error("P6 resource map: duplicate rsrc_short_name in rate card");
    }
    shortNames.add(rsrc_short_name);

    const rsrc_type = inferRsrcType(String(e.resourceType ?? ""));
    const cost_qty_type = inferCostQtyType(String(e.unit ?? ""));

    const rsrc_id = p6DeterministicRsrcId(scope, String(e.resourceType ?? ""), rsrc_name);
    const rsrc_seq_num = p6DeterministicRsrcSeqNum(scope, rsrc_short_name);
    const rsrc_rate_id = p6DeterministicRsrcRateId(rsrc_id, rateStart);

    const r: P6Resource = {
      rsrc_id,
      rsrc_seq_num,
      rsrc_rate_id,
      rsrc_name,
      rsrc_short_name,
      cost_per_qty,
      rsrc_type,
      cost_qty_type,
      unit: String(e.unit ?? "").trim(),
    };

    const k = key(String(e.resourceType ?? ""), rsrc_name);
    if (byTypeName.has(k)) continue;
    resources.push(r);
    byTypeName.set(k, r);
    byShortName.set(rsrc_short_name, r);
  }

  return { resources, byTypeName, byShortName };
}
