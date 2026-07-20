/**
 * Project detection unit tests (no database).
 * Run: npm run build && node --test tests/integration/project-detection.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { detectProjectFromXer } from "../../dist/services/import/projectDetection.service.js";

function buildMinimalXer({
  projectName,
  shortName,
  rootName = "Root Project",
  wbsNames = [],
  tasks = [],
  relationships = [],
}) {
  const lines = [
    "ERMHDR\t18.8\t2024-01-01\tProject\tadmin\t",
    "%T\tPROJECT",
    "%F\tproj_id\tproj_short_name\tproj_name\tplan_start_date\tplan_end_date",
    `%R\tP1\t${shortName ?? ""}\t${projectName ?? ""}\t2024-01-01 08:00\t2025-12-31 17:00`,
    "%T\tPROJWBS",
    "%F\twbs_id\tparent_wbs_id\twbs_name\tproj_node_flag",
    `%R\t1\t\t${rootName}\tY`,
  ];
  for (let i = 0; i < wbsNames.length; i++) {
    lines.push(`%R\t${i + 2}\t1\t${wbsNames[i]}\tN`);
  }
  lines.push("%T\tTASK");
  lines.push("%F\ttask_id\ttask_code\ttask_name\ttask_descr\twbs_id\tstatus_code\tphys_complete_pct");
  for (const [idx, t] of tasks.entries()) {
    lines.push(
      `%R\t${idx + 1}\t${t.code}\t${t.name}\t${t.description ?? ""}\t${t.wbsId ?? "2"}\t${t.status ?? "TK_NotStart"}\t${t.pct ?? "0"}`
    );
  }
  lines.push("%T\tTASKPRED");
  lines.push("%F\ttask_id\tpred_task_id\tpred_type");
  for (const relationship of relationships) {
    lines.push(`%R\t${relationship.taskId}\t${relationship.predTaskId}\tPR_FS`);
  }
  lines.push("%T\tCALENDAR");
  lines.push("%F\tclndr_id\tclndr_name");
  lines.push("%R\t1\tStandard");
  return lines.join("\n");
}

describe("project detection from XER", () => {
  it("detects Primavera project name over short name and filename", () => {
    const xer = buildMinimalXer({
      projectName: "Northvale Emergency Care Wing",
      shortName: "NECW",
      tasks: [{ code: "A100", name: "Site establishment" }],
    });
    const buffer = Buffer.from(xer, "utf8");
    const result = detectProjectFromXer({ buffer, fileName: "random-export.xer" });
    assert.equal(result.projectName.value, "Northvale Emergency Care Wing");
    assert.equal(result.projectName.confidence, "high");
    assert.match(result.projectName.source, /Primavera/i);
  });

  it("detects healthcare project type and NHS client from programme text", () => {
    const xer = buildMinimalXer({
      projectName: "NHS Trust Hospital Extension",
      shortName: "NHSE",
      wbsNames: ["Ward Block", "MRI Suite"],
      tasks: [
        { code: "A1", name: "ICU fit-out" },
        { code: "A2", name: "Theatre construction" },
        { code: "A3", name: "Hospital ward finishes" },
      ],
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "hospital.xer" });
    assert.equal(result.clientType.value, "NHS Trust");
    assert.equal(result.projectType.value, "Healthcare");
    assert.ok(["high", "medium"].includes(result.projectType.confidence));
  });

  it("keeps subordinate Link Bridge references within a hospital programme", () => {
    const xer = buildMinimalXer({
      projectName: "Acute Care Expansion",
      shortName: "ACE",
      rootName: "Northvale General Hospital Programme",
      wbsNames: ["Emergency Department", "VI-061 Link Bridge Option"],
      tasks: [
        { code: "H1", name: "Clinical ward design" },
        { code: "H2", name: "Operating theatre layout" },
        { code: "B1", name: "Link Bridge structural issue" },
      ],
      relationships: [{ taskId: 3, predTaskId: 1 }],
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "hospital-programme.xer" });
    assert.equal(result.projectType.value, "Healthcare");
    assert.match(result.projectType.trace.conflictResolution ?? "", /subordinate bridge/i);
  });

  it("preserves genuine bridge programme detection", () => {
    const xer = buildMinimalXer({
      projectName: "River Crossing Bridge Replacement",
      shortName: "RCBR",
      rootName: "River Bridge Programme",
      wbsNames: ["Bridge Deck", "East Abutment", "Piers"],
      tasks: [
        { code: "B1", name: "Bridge deck design" },
        { code: "B2", name: "Abutment construction" },
        { code: "B3", name: "Pier reinforcement" },
      ],
      relationships: [
        { taskId: 2, predTaskId: 1 },
        { taskId: 3, predTaskId: 2 },
      ],
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "river-bridge.xer" });
    assert.equal(result.projectType.value, "Bridge");
    assert.ok(["high", "medium"].includes(result.projectType.confidence));
  });

  it("detects rail project type from keywords", () => {
    const xer = buildMinimalXer({
      projectName: "Northern Line Upgrade",
      shortName: "NLU",
      wbsNames: ["Station Works", "Track Renewals"],
      tasks: [
        { code: "R1", name: "Platform extension" },
        { code: "R2", name: "Signalling commissioning" },
        { code: "R3", name: "Rail track installation" },
      ],
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "rail.xer" });
    assert.equal(result.projectType.value, "Rail");
  });

  it("detects construction stage from in-progress activities", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      code: `C${i}`,
      name: `Concrete pour ${i}`,
      status: i < 6 ? "TK_Active" : "TK_NotStart",
      pct: i < 6 ? "35" : "0",
    }));
    const xer = buildMinimalXer({
      projectName: "Road Junction Improvement",
      shortName: "RJI",
      wbsNames: ["Earthworks", "Carriageway"],
      tasks,
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "road.xer" });
    assert.equal(result.stage.value, "Construction");
  });

  it("uses Detailed Design evidence instead of inferring Commissioning from progress", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      code: `D${i}`,
      name: i < 6 ? `Stage 4 structural design package ${i}` : `Detailed Design review ${i}`,
      status: i < 8 ? "TK_Complete" : "TK_Active",
      pct: i < 8 ? "100" : "50",
    }));
    const xer = buildMinimalXer({
      projectName: "Hospital Engineering Design",
      shortName: "HED",
      rootName: "Hospital Detailed Design",
      wbsNames: ["Detailed Design", "Model/Drawing Development"],
      tasks,
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "design.xer" });
    assert.equal(result.stage.value, "Detailed Design");
    assert.notEqual(result.stage.value, "Commissioning");
    assert.match(result.stage.trace.conflictResolution ?? "", /did not override/i);
  });

  it("assigns Commissioning only when commissioning and handover content dominates", () => {
    const xer = buildMinimalXer({
      projectName: "Energy Centre Completion",
      shortName: "ECC",
      rootName: "Commissioning and Handover Programme",
      wbsNames: ["Systems Commissioning", "Operational Handover"],
      tasks: [
        { code: "C1", name: "Mechanical systems commissioning", status: "TK_Active", pct: "80" },
        { code: "C2", name: "Electrical commissioning", status: "TK_Active", pct: "75" },
        { code: "C3", name: "Integrated systems testing", status: "TK_NotStart", pct: "0" },
        { code: "C4", name: "Handover documentation", status: "TK_Active", pct: "60" },
        { code: "C5", name: "Practical completion inspection", status: "TK_NotStart", pct: "0" },
      ],
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "handover.xer" });
    assert.equal(result.stage.value, "Commissioning");
    assert.match(result.stage.reason, /commissioning|handover/i);
  });

  it("deduplicates repeated evidence while preserving its source", () => {
    const repeated = Array.from({ length: 8 }, (_, i) => ({
      code: `H${i}`,
      name: "Hospital ward design",
    }));
    const xer = buildMinimalXer({
      projectName: "Campus Works",
      shortName: "CW",
      rootName: "Healthcare Campus",
      tasks: repeated,
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "campus.xer" });
    const healthcare = result.projectType.trace.matchedKeywords?.find((item) => item.label === "Healthcare");
    const activityHospitalHit = healthcare?.matchedKeywords.find(
      (hit) => hit.pattern === "hospital" && hit.source === "activity_names"
    );
    assert.equal(activityHospitalHit?.count, 1);
  });

  it("uses hospital root plus repeated genuine Trust references for NHS client", () => {
    const xer = buildMinimalXer({
      projectName: "Clinical Expansion",
      shortName: "CE",
      rootName: "Northvale General Hospital Programme",
      tasks: [
        { code: "T1", name: "Trust governance approval" },
        { code: "T2", name: "Receive clinical brief from Trust" },
      ],
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "clinical.xer" });
    assert.equal(result.clientType.value, "NHS Trust");
  });

  it("leaves client blank for a lone generic Trust reference", () => {
    const xer = buildMinimalXer({
      projectName: "Clinical Expansion",
      shortName: "CE",
      rootName: "Northvale General Hospital Programme",
      tasks: [{ code: "T1", name: "Trust governance approval" }],
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "clinical.xer" });
    assert.equal(result.clientType.value, null);
  });

  it("classifies complexity from programme size signals", () => {
    const tasks = Array.from({ length: 600 }, (_, i) => ({
      code: `T${i}`,
      name: `Activity ${i}`,
      status: "TK_Active",
      pct: "20",
    }));
    const xer = buildMinimalXer({
      projectName: "Large Commercial Tower",
      shortName: "LCT",
      wbsNames: Array.from({ length: 15 }, (_, i) => `Workstream ${i}`),
      tasks,
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "commercial.xer" });
    assert.ok(["Medium", "High", "Very High"].includes(result.complexity.value ?? ""));
    assert.ok(result.complexity.confidence !== "none");
  });

  it("does not invent client when no keywords match", () => {
    const xer = buildMinimalXer({
      projectName: "Alpha Site Works",
      shortName: "ASW",
      tasks: [{ code: "X1", name: "General mobilisation" }],
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "generic.xer" });
    assert.equal(result.clientType.value, null);
    assert.equal(result.clientType.confidence, "none");
  });

  it("falls back to filename only when no Primavera name exists", () => {
    const xer = buildMinimalXer({
      projectName: "",
      shortName: "",
      rootName: "Project",
      tasks: [{ code: "A1", name: "Task one" }],
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "my-programme.xer" });
    assert.equal(result.projectName.value, "my programme");
    assert.equal(result.projectName.confidence, "low");
    assert.ok(result.projectName.needsConfirmation);
  });

  it("regresses synthetic healthcare programme classification from the validation XER", () => {
    const xerPath = resolve(
      "validation",
      "synthetic-healthcare",
      "SYN1 Northvale June 2026 Programme - Copy.xer"
    );
    const result = detectProjectFromXer({
      buffer: readFileSync(xerPath),
      fileName: basename(xerPath),
    });
    assert.equal(result.projectName.value, "SYN1 Northvale June 2026 Programme");
    assert.equal(result.projectType.value, "Healthcare");
    assert.equal(result.stage.value, "Detailed Design");
    if (result.clientType.value !== null) {
      assert.equal(result.clientType.value, "NHS Trust");
      assert.ok(["high", "medium"].includes(result.clientType.confidence));
    }
  });
});
