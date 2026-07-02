/**
 * Project detection validation regression tests.
 * Run: npm run build && node --test tests/integration/project-detection-validation.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectProjectFromXer } from "../../dist/services/import/projectDetection.service.js";
import {
  validateAllDatasets,
  validateDetectionAgainstExpected,
  listValidationDatasets,
} from "../../dist/services/import/projectDetectionValidation.service.js";
import { formatDetectionReport, formatValidationReport } from "../../dist/services/import/projectDetectionReport.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const validationRoot = join(__dirname, "../../validation");

describe("project detection traceability", () => {
  it("exposes sources searched and confidence reasoning on every field", () => {
    const xer = [
      "ERMHDR\t18.8\t2024-01-01\tProject\tadmin\t",
      "%T\tPROJECT",
      "%F\tproj_id\tproj_short_name\tproj_name",
      "%R\tP1\tSHORT\tFull Project Name",
      "%T\tTASK",
      "%F\ttask_id\ttask_code\ttask_name\tstatus_code\tphys_complete_pct",
      "%R\t1\tA1\tTest activity\tTK_NotStart\t0",
    ].join("\n");

    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "fallback.xer" });
    for (const key of ["projectName", "clientType", "projectType", "stage", "complexity"]) {
      const f = result[key];
      assert.ok(f.trace, `${key} should have trace`);
      assert.ok(Array.isArray(f.trace.sourcesSearched), `${key} sourcesSearched`);
      assert.ok(typeof f.trace.confidenceReasoning === "string", `${key} confidenceReasoning`);
    }
    assert.equal(result.projectName.value, "Full Project Name");
    assert.ok(result.projectName.trace.rawSignals?.sourceUsed !== "filename");
    assert.ok(result.complexity.complexityDetail);
    assert.ok(result.complexity.complexityDetail.score >= 0);
    assert.ok(result.detectionTimeMs >= 0);
  });

  it("reduces project type confidence when top scores conflict", () => {
    const xer = [
      "ERMHDR\t18.8\t2024-01-01\tProject\tadmin\t",
      "%T\tPROJECT",
      "%F\tproj_id\tproj_short_name\tproj_name",
      "%R\tP1\tMIX\tCampus Hospital Office University Industrial",
      "%T\tPROJWBS",
      "%F\twbs_id\tparent_wbs_id\twbs_name",
      "%R\t1\t\tRoot",
      "%R\t2\t1\tHospital Ward",
      "%R\t3\t1\tOffice Tower",
      "%R\t4\t1\tUniversity Campus",
      "%R\t5\t1\tIndustrial Plant",
      "%T\tTASK",
      "%F\ttask_id\ttask_code\ttask_name\twbs_id\tstatus_code\tphys_complete_pct",
      "%R\t1\tA1\tHospital clinical ward fit-out\t2\tTK_NotStart\t0",
      "%R\t2\tA2\tOffice commercial fit-out\t3\tTK_NotStart\t0",
      "%R\t3\tA3\tUniversity classroom fit-out\t4\tTK_NotStart\t0",
      "%R\t4\tA4\tIndustrial process plant fit-out\t5\tTK_NotStart\t0",
    ].join("\n");

    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "mixed.xer" });
    const alternatives = result.projectType.trace.matchedKeywords ?? [];
    assert.ok(alternatives.length >= 2, "should surface multiple sector candidates");
    if (result.projectType.value != null) {
      assert.notEqual(result.projectType.confidence, "high", "conflicting sectors must not yield high confidence");
      assert.ok(result.projectType.needsConfirmation);
    } else {
      assert.equal(result.projectType.confidence, "low");
    }
    assert.ok(result.projectType.trace.rejectedMatches?.length);
  });

  it("produces human-readable detection report", () => {
    const xer = [
      "ERMHDR\t18.8\t2024-01-01\tProject\tadmin\t",
      "%T\tPROJECT",
      "%F\tproj_id\tproj_short_name\tproj_name",
      "%R\tP1\tT\tTest",
      "%T\tTASK",
      "%F\ttask_id\ttask_code\ttask_name\tstatus_code\tphys_complete_pct",
      "%R\t1\tA1\tActivity\tTK_NotStart\t0",
    ].join("\n");
    const detection = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "t.xer" });
    const report = formatDetectionReport(detection);
    assert.match(report, /Programme Detection Report/);
    assert.match(report, /Project Name/);
    assert.match(report, /Sources searched/);
  });
});

describe("project detection validation datasets", () => {
  it("lists registered validation datasets", () => {
    const datasets = listValidationDatasets(validationRoot);
    assert.ok(datasets.some((d) => d.id === "synthetic-hospital"));
    assert.ok(datasets.some((d) => d.id === "RedactedSite"));
  });

  it("passes all synthetic validation datasets", () => {
    const summary = validateAllDatasets(validationRoot);
    const synthetic = summary.datasets.filter((d) => d.datasetId.startsWith("synthetic-"));
    assert.ok(synthetic.length >= 3, "expected at least 3 synthetic datasets with .xer files");
    for (const report of synthetic) {
      assert.equal(report.passed, true, `${report.datasetId} should pass:\n${formatValidationReport(report)}`);
    }
    assert.equal(summary.allPassed, true);
  });

  it("validates field-level match status", () => {
    const summary = validateAllDatasets(validationRoot);
    const hospital = summary.datasets.find((d) => d.datasetId === "synthetic-hospital");
    assert.ok(hospital);
    const typeField = hospital.fields.find((f) => f.field === "projectType");
    assert.equal(typeField?.status, "passed");
    assert.equal(typeField?.detected, "Healthcare");
  });
});
