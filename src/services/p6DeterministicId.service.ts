import { createHash } from "node:crypto";

/** 31-bit positive int from SHA-256 (stable across runs). */
function u31(namespace: string, key: string): number {
  const h = createHash("sha256").update(namespace, "utf8").update("\x1c").update(key, "utf8").digest();
  return h.readUInt32BE(0) & 0x7fffffff;
}

/** Disjoint numeric bands to avoid collisions with template/proj WBS ids and RSRC ids (~1e8). */
const BAND_ACTV_TYPE = 1_100_000_000;
const BAND_ACTV_CODE = 1_200_000_000;
/** Narrow spans for resource/schedule ids so bands stay disjoint from each other and from {@link BAND_TASK}. */
const NARROW_SPAN = 6_000_000;
const BAND_RSRC_SEQ = 1_260_000_000;
const BAND_RSRC = 1_266_000_000;
const BAND_RSRC_RATE = 1_272_000_000;
const BAND_TASK_PRED = 1_278_000_000;
const BAND_TASK_RSRC = 1_284_000_000;
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

export function p6DeterministicRsrcId(scope: string, resourceType: string, resourceName: string): number {
  const key = `${scope}\x1d${resourceType}\x1d${resourceName}`;
  return BAND_RSRC + (u31("P6_RSRC", key) % NARROW_SPAN);
}

export function p6DeterministicRsrcRateId(rsrcId: number, rateStartDate: string): number {
  return BAND_RSRC_RATE + (u31("P6_RSRCRATE", `${rsrcId}\x1d${rateStartDate}`) % NARROW_SPAN);
}

export function p6DeterministicRsrcSeqNum(scope: string, rsrcShortName: string): number {
  return BAND_RSRC_SEQ + (u31("P6_RSRCSEQ", `${scope}\x1d${rsrcShortName}`) % NARROW_SPAN);
}

export function p6DeterministicTaskRsrcId(scope: string, taskId: number, rsrcId: number, slotIndex: number): number {
  return BAND_TASK_RSRC + (u31("P6_TASKRSRC", `${scope}\x1d${taskId}\x1d${rsrcId}\x1d${slotIndex}`) % NARROW_SPAN);
}

export function p6DeterministicTaskPredId(
  scope: string,
  predTaskId: number,
  succTaskId: number,
  predType: string,
  lagHr: number
): number {
  return BAND_TASK_PRED + (u31("P6_TASKPRED", `${scope}\x1d${predTaskId}\x1d${succTaskId}\x1d${predType}\x1d${lagHr}`) % NARROW_SPAN);
}
