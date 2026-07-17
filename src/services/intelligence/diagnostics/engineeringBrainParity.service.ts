/**
 * Engineering Brain UI ↔ export parity invariants — DEVELOPER ONLY.
 */
import type { EngineeringBrainDiagnosticsReport } from "./engineeringBrainDiagnostics.service.js";
import type { EngineeringBrainExportV2 } from "./engineeringBrainExportMapper.service.js";

export type BrainParityResult = {
  valid: boolean;
  errors: string[];
};

function visibleExportFingerprints(exportBrain: EngineeringBrainExportV2): Set<string> {
  return new Set([
    ...exportBrain.needsReview.map((e) => e.fingerprint),
    ...exportBrain.autoApproved.map((e) => e.fingerprint),
    ...exportBrain.trustedKnowledge.map((e) => e.fingerprint),
    ...exportBrain.developerModified.map((e) => e.fingerprint),
  ]);
}

function visibleUiFingerprints(report: EngineeringBrainDiagnosticsReport): Set<string> {
  return new Set([
    ...report.collections.needsReview.map((e) => e.fingerprint),
    ...report.collections.autoApproved.map((e) => e.fingerprint),
    ...report.collections.developerApproved.map((e) => e.fingerprint),
    ...report.collections.developerModified.map((e) => e.fingerprint),
  ]);
}

function duplicateFingerprintsInBucket(entries: Array<{ fingerprint: string }>): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry.fingerprint)) dupes.push(entry.fingerprint);
    seen.add(entry.fingerprint);
  }
  return dupes;
}

/** Verify export is a lossless serialization of the canonical diagnostics report. */
export function validateBrainUiParity(
  exportBrain: EngineeringBrainExportV2,
  report: EngineeringBrainDiagnosticsReport
): BrainParityResult {
  const errors: string[] = [];
  const s = report.summary;

  if (exportBrain.summary.total !== s.totalVisible) {
    errors.push(`export.summary.total (${exportBrain.summary.total}) !== report.summary.totalVisible (${s.totalVisible})`);
  }
  if (exportBrain.summary.needsReview !== s.brainInbox) {
    errors.push(`needsReview count (${exportBrain.summary.needsReview}) !== summary.brainInbox (${s.brainInbox})`);
  }
  if (exportBrain.summary.autoApproved !== s.autoApproved) {
    errors.push(`autoApproved count mismatch`);
  }
  if (exportBrain.summary.trustedKnowledge !== s.developerApproved) {
    errors.push(`trustedKnowledge (dev approved) count mismatch`);
  }
  if (exportBrain.summary.developerModified !== s.developerModified) {
    errors.push(`developerModified count mismatch`);
  }
  if (exportBrain.summary.rejected !== s.rejected) {
    errors.push(`rejected count mismatch`);
  }
  if (exportBrain.ui.brainInbox !== s.brainInbox) {
    errors.push(`ui.brainInbox mismatch`);
  }
  if (exportBrain.ui.trustedKnowledge !== s.trustedKnowledge) {
    errors.push(`ui.trustedKnowledge mismatch`);
  }
  if (exportBrain.ui.totalVisible !== s.totalVisible) {
    errors.push(`ui.totalVisible mismatch`);
  }

  const exportVisible = visibleExportFingerprints(exportBrain);
  const uiVisible = visibleUiFingerprints(report);
  if (exportVisible.size !== uiVisible.size) {
    errors.push(`visible fingerprint count export (${exportVisible.size}) !== UI (${uiVisible.size})`);
  }
  for (const fp of uiVisible) {
    if (!exportVisible.has(fp)) errors.push(`UI fingerprint missing from export: ${fp}`);
  }
  for (const fp of exportVisible) {
    if (!uiVisible.has(fp)) errors.push(`Export fingerprint not in UI: ${fp}`);
  }

  for (const [bucket, entries] of [
    ["needsReview", exportBrain.needsReview],
    ["autoApproved", exportBrain.autoApproved],
    ["trustedKnowledge", exportBrain.trustedKnowledge],
    ["developerModified", exportBrain.developerModified],
    ["rejected", exportBrain.rejected],
  ] as const) {
    const dupes = duplicateFingerprintsInBucket(entries);
    for (const fp of dupes) {
      errors.push(`duplicate fingerprint in export bucket ${bucket}: ${fp}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
