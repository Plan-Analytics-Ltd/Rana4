import { createHash } from "node:crypto";

/** 31-bit positive int from SHA-256 (stable across runs). */
function u31(namespace: string, key: string): number {
  const h = createHash("sha256").update(namespace, "utf8").update("\x1c").update(key, "utf8").digest();
  return h.readUInt32BE(0) & 0x7fffffff;
}

/** Disjoint numeric bands to avoid collisions with template/proj WBS ids and RSRC ids (~1e8). */
const BAND_ACTV_TYPE = 1_100_000_000;
const BAND_ACTV_CODE = 1_200_000_000;
const BAND_TASK = 1_450_000_000;
const BAND_SPAN = 80_000_000;

export function p6DeterministicActvTypeId(typeSlug: string): number {
  return BAND_ACTV_TYPE + (u31("P6_ACTVTYPE", typeSlug) % BAND_SPAN);
}

/** `exportKey` should include type slug + stable value token (e.g. `RIBA_STAGE:STAGE_1`). */
export function p6DeterministicActvCodeId(exportKey: string): number {
  return BAND_ACTV_CODE + (u31("P6_ACTVCODE", exportKey) % BAND_SPAN);
}

export function p6DeterministicTaskId(scope: string, taskCode: string): number {
  return BAND_TASK + (u31("P6_TASK", `${scope}\x1d${taskCode}`) % BAND_SPAN);
}
