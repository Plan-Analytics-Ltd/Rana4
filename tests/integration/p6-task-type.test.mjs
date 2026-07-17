import test from "node:test";
import assert from "node:assert/strict";
import { parseXerProgramme } from "../../dist/services/intelligence/shared/xerParse.service.js";
import {
  isP6MilestoneType,
  isP6ResourceTask,
  resolveP6TaskTypeForExport,
  P6_DEFAULT_TASK_TYPE,
} from "../../dist/services/p6TaskType.service.js";
import { parseRana4ProgrammeJson } from "../../dist/services/intelligence/shared/rana4ScheduleExport.service.js";

function minimalXer(taskRows) {
  const taskFields = [
    "task_id",
    "proj_id",
    "wbs_id",
    "task_code",
    "task_name",
    "task_type",
    "target_drtn_hr_cnt",
    "remain_drtn_hr_cnt",
    "total_float_hr_cnt",
    "free_float_hr_cnt",
    "status_code",
    "phys_complete_pct",
  ].join("\t");

  const lines = [
    "%T\tPROJECT",
    "%F\tproj_id\tlast_schedule_date",
    "%R\t1\t2025-01-01 00:00",
    "%T\tTASK",
    `%F\t${taskFields}`,
    ...taskRows,
    "%E",
  ];
  return lines.join("\n");
}

test("parseXerProgramme maps TASK.task_type to p6TaskType unchanged", () => {
  const xer = minimalXer([
    "%R\t1\t1\t1\tA1001\tDesign task\tTT_Task\t80\t80\t0\t0\tTK_NotStart\t0",
    "%R\t2\t1\t1\tA1002\tFinish milestone\tTT_FinMile\t0\t0\t0\t0\tTK_NotStart\t0",
    "%R\t3\t1\t1\tA1003\tResource task\tTT_Rsrc\t40\t40\t0\t0\tTK_NotStart\t0",
  ]);

  const parsed = parseXerProgramme(xer);
  const byCode = new Map(parsed.activities.map((a) => [a.activityCode, a]));

  assert.equal(byCode.get("A1001")?.p6TaskType, "TT_Task");
  assert.equal(byCode.get("A1002")?.p6TaskType, "TT_FinMile");
  assert.equal(byCode.get("A1003")?.p6TaskType, "TT_Rsrc");
});

test("p6 task type helpers classify milestone and resource types", () => {
  assert.equal(isP6MilestoneType("TT_Mile"), true);
  assert.equal(isP6MilestoneType("TT_StartMile"), true);
  assert.equal(isP6MilestoneType("TT_FinMile"), true);
  assert.equal(isP6MilestoneType("TT_Task"), false);
  assert.equal(isP6MilestoneType(null), false);

  assert.equal(isP6ResourceTask("TT_Rsrc"), true);
  assert.equal(isP6ResourceTask("TT_Task"), false);
  assert.equal(isP6ResourceTask(undefined), false);
});

test("export resolves stored task type or defaults to TT_Task", () => {
  assert.equal(resolveP6TaskTypeForExport("TT_FinMile"), "TT_FinMile");
  assert.equal(resolveP6TaskTypeForExport(null), P6_DEFAULT_TASK_TYPE);
  assert.equal(resolveP6TaskTypeForExport(""), P6_DEFAULT_TASK_TYPE);
  assert.equal(resolveP6TaskTypeForExport("  "), P6_DEFAULT_TASK_TYPE);
});

test("rana4 JSON round-trip preserves p6TaskType", () => {
  const json = JSON.stringify({
    format: "rana4-programme",
    version: 1,
    exportedAt: new Date().toISOString(),
    projectId: "p1",
    projectName: "Test",
    scheduleStartDate: null,
    activities: [
      {
        activityCode: "A1",
        p6TaskType: "TT_StartMile",
        originalDurationDays: 0,
        remainingDurationDays: 0,
      },
    ],
    deliverables: [],
    relationships: [],
  });

  const parsed = parseRana4ProgrammeJson(json);
  assert.equal(parsed.activities[0]?.p6TaskType, "TT_StartMile");
});

test("ask rana knowledge package carries activityTaskTypes metadata", async () => {
  const { buildAskRanaKnowledgePackage } = await import(
    "../../dist/services/ask-rana/askRanaKnowledgePackage.service.js"
  );
  const { interpretPlannerQuery } = await import(
    "../../dist/services/ask-rana/askRanaPlannerQueryInterpreter.service.js"
  );
  const { verifyPlannerQuestion } = await import(
    "../../dist/services/ask-rana/askRanaQuestionVerification.service.js"
  );
  const { buildPlannerInvestigation } = await import(
    "../../dist/services/ask-rana/askRanaInvestigation.service.js"
  );
  const { classifyPlannerResponseDepth } = await import(
    "../../dist/services/ask-rana/askRanaResponseDepth.service.js"
  );

  const pkg = {
    deliverable: { name: "WP1", classification: null, currentDurationDays: 5 },
    linkedActivities: [
      { activityCode: "A1001", name: "Milestone", p6TaskType: "TT_FinMile" },
      { activityCode: "A1002", name: "Task", p6TaskType: null },
    ],
    sources: [],
    evidenceGaps: [],
    previousProjects: null,
    projectEvolution: null,
    programmeLogic: null,
    recommendations: null,
    observations: null,
    keyFactors: null,
    trust: null,
    lessonsLearned: null,
    similarProjects: null,
  };

  const question = "What is the programme logic?";
  const plannerQuery = interpretPlannerQuery(question);
  const responseDepth = classifyPlannerResponseDepth({ question, plannerQuery });
  const verification = verifyPlannerQuestion({
    question,
    evidencePackage: pkg,
    plannerQuery,
    responseDepth: responseDepth.depth,
  });
  const investigation = buildPlannerInvestigation({
    question,
    evidencePackage: pkg,
    plannerQuery,
    depth: responseDepth.depth,
    followUpIntent: responseDepth.followUpIntent,
  });

  const knowledge = buildAskRanaKnowledgePackage({
    evidencePackage: pkg,
    plannerQuery,
    verification,
    responseDepth,
    investigation,
  });

  assert.deepEqual(knowledge.activityTaskTypes, [
    { activityCode: "A1001", p6TaskType: "TT_FinMile" },
    { activityCode: "A1002", p6TaskType: null },
  ]);
});
