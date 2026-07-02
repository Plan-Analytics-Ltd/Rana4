#!/usr/bin/env node
/**
 * Project Detection validation CLI.
 * Run: npm run validate:detection
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateAllDatasets,
  listValidationDatasets,
} from "../../../dist/services/import/projectDetectionValidation.service.js";
import {
  formatDatasetSummary,
  formatDetectionReport,
} from "../../../dist/services/import/projectDetectionReport.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const validationRoot = join(__dirname, "../../../validation");

const datasets = listValidationDatasets(validationRoot);
console.log("Project Detection Validation");
console.log("============================\n");
console.log("Registered datasets:");
for (const d of datasets) {
  const status = d.xerCount === 0 ? "SKIP (no .xer)" : "READY";
  console.log(`  • ${d.id}: ${status}${d.notes ? ` — ${d.notes}` : ""}`);
}
console.log("");

const summary = validateAllDatasets(validationRoot);

if (summary.datasets.length === 0) {
  console.log("No datasets with .xer files to validate.");
  console.log("Add Primavera exports under validation/<dataset-id>/ and re-run.\n");
  process.exit(0);
}

console.log(formatDatasetSummary(summary));
console.log("");

for (const report of summary.datasets) {
  console.log("\n--- Detection trace (human-readable) ---\n");
  console.log(formatDetectionReport(report.detection, `Detection: ${report.datasetId}/${report.xerFile}`));
}

if (!summary.allPassed) {
  console.error("\nValidation FAILED — detection accuracy below threshold or field mismatches.");
  process.exit(1);
}

console.log("\nValidation PASSED.");
process.exit(0);
