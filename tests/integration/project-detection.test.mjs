/**
 * Project detection unit tests (no database).
 * Run: npm run build && node --test tests/integration/project-detection.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectProjectFromXer } from "../../dist/services/import/projectDetection.service.js";

function buildMinimalXer({
  projectName,
  shortName,
  wbsNames = [],
  tasks = [],
}) {
  const lines = [
    "ERMHDR\t18.8\t2024-01-01\tProject\tadmin\t",
    "%T\tPROJECT",
    "%F\tproj_id\tproj_short_name\tproj_name\tplan_start_date\tplan_end_date",
    `%R\tP1\t${shortName ?? ""}\t${projectName ?? ""}\t2024-01-01 08:00\t2025-12-31 17:00`,
    "%T\tPROJWBS",
    "%F\twbs_id\tparent_wbs_id\twbs_name",
    "%R\t1\t\tRoot Project",
  ];
  for (let i = 0; i < wbsNames.length; i++) {
    lines.push(`%R\t${i + 2}\t1\t${wbsNames[i]}`);
  }
  lines.push("%T\tTASK");
  lines.push("%F\ttask_id\ttask_code\ttask_name\twbs_id\tstatus_code\tphys_complete_pct");
  for (const [idx, t] of tasks.entries()) {
    lines.push(
      `%R\t${idx + 1}\t${t.code}\t${t.name}\t${t.wbsId ?? "2"}\t${t.status ?? "TK_NotStart"}\t${t.pct ?? "0"}`
    );
  }
  lines.push("%T\tTASKPRED");
  lines.push("%F\ttask_id\tpred_task_id\tpred_type");
  lines.push("%T\tCALENDAR");
  lines.push("%F\tclndr_id\tclndr_name");
  lines.push("%R\t1\tStandard");
  return lines.join("\n");
}

describe("project detection from XER", () => {
  it("detects Primavera project name over short name and filename", () => {
    const xer = buildMinimalXer({
      projectName: "REDACTED-SITE Emergency Care Building",
      shortName: "DECB",
      tasks: [{ code: "A100", name: "Site establishment" }],
    });
    const buffer = Buffer.from(xer, "utf8");
    const result = detectProjectFromXer({ buffer, fileName: "random-export.xer" });
    assert.equal(result.projectName.value, "REDACTED-SITE Emergency Care Building");
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
      tasks: [{ code: "A1", name: "Task one" }],
    });
    const result = detectProjectFromXer({ buffer: Buffer.from(xer), fileName: "my-programme.xer" });
    assert.equal(result.projectName.value, "my programme");
    assert.equal(result.projectName.confidence, "low");
    assert.ok(result.projectName.needsConfirmation);
  });
});
