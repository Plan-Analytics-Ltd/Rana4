import type { RateCardEntry } from "./rateCard.js";
import { compareResourcesForP6Order } from "./p6ResourceSort.js";

export type P6Resource = {
  rsrc_id: number;
  rsrc_seq_num: number;
  rsrc_rate_id: number;
  rsrc_name: string;
  rsrc_short_name: string;
  cost_per_qty: number;
};

function norm(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

function key(type: string, name: string): string {
  return `${norm(type)}|${norm(name)}`;
}

/**
 * Single source of truth for P6 resources derived from the rate card.
 *
 * ID rules (STRICT):
 * - rsrc_id = 99999900 + index
 * - rsrc_seq_num = 460000000 + index
 * - rsrc_rate_id = 999900 + index
 *
 * Index is 1-based in a stable sorted order.
 */
export function buildP6ResourceMap(entries: RateCardEntry[]): {
  resources: P6Resource[];
  byTypeName: Map<string, P6Resource>;
} {
  const sorted = [...entries].sort(compareResourcesForP6Order);

  const resources: P6Resource[] = [];
  const byTypeName = new Map<string, P6Resource>();
  const shortNames = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!;
    const rsrc_name = String(e.resourceName ?? "").trim();
    const cost_per_qty = Number(e.rate);

    if (!rsrc_name) {
      throw new Error("rate card: resourceName is required for P6 rsrc_name");
    }
    if (!Number.isFinite(cost_per_qty) || cost_per_qty < 0) {
      throw new Error(`rate card: invalid rate for ${rsrc_name}`);
    }

    const rsrc_short_name = String(e.rsrcShortName ?? "").trim();
    if (!rsrc_short_name) {
      throw new Error(`rate card: missing rsrcShortName for ${String(e.resourceType)} / ${rsrc_name}`);
    }
    if (shortNames.has(rsrc_short_name)) {
      throw new Error(`P6 resource map: duplicate rsrc_short_name in rate card: ${rsrc_short_name}`);
    }
    shortNames.add(rsrc_short_name);

    const index = i + 1;
    const r: P6Resource = {
      rsrc_id: 99999900 + index,
      rsrc_seq_num: 460000000 + index,
      rsrc_rate_id: 999900 + index,
      rsrc_name,
      rsrc_short_name,
      cost_per_qty,
    };

    const k = key(String(e.resourceType ?? ""), rsrc_name);
    if (byTypeName.has(k)) continue; // defensive: duplicate rows in DB
    resources.push(r);
    byTypeName.set(k, r);
  }

  return { resources, byTypeName };
}

