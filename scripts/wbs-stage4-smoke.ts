/**
 * Stage 4 smoke: mapToXER (pure mapping, no HTTP).
 * Run: npm run test:wbs-stage4
 */
import type { Activity } from "@prisma/client";
import type { GeneratedWbs } from "../src/services/wbsGenerate.service.js";
import { mapToXER } from "../src/services/xerWbsMap.service.js";

const stubActivity = (id: string, deliverableId: string): Activity =>
  ({
    id,
    fragnetId: "fragnet",
    deliverableId,
    activityCode: id.slice(0, 8),
    name: `Task ${id}`,
    bestDuration: 1,
    likelyDuration: 1,
    assuranceNoteId: null,
    assignedResources: [],
    createdAt: new Date(0),
  }) as Activity;

function main(): void {
  const dA = "11111111-1111-4111-8111-111111111111";
  const dB = "22222222-2222-4222-8222-222222222222";
  const wbs: GeneratedWbs = {
    project_wbs: { wbs_id: 1, wbs_short_name: "1", wbs_name: "P6-100" },
    deliverable_wbs_list: [
      {
        deliverable_id: dA,
        wbs_id: 2,
        wbs_short_name: "2",
        wbs_name: "Package A",
        activities: [stubActivity("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", dA)],
        stageFragnetId: null,
        stageDisplayName: "P6-100",
        deliverableSourceName: "Package A",
      },
      {
        deliverable_id: dB,
        wbs_id: 3,
        wbs_short_name: "3",
        wbs_name: "Package B",
        activities: [
          stubActivity("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", dB),
          stubActivity("cccccccc-cccc-4ccc-8ccc-cccccccccccc", dB),
        ],
        stageFragnetId: null,
        stageDisplayName: "P6-100",
        deliverableSourceName: "Package B",
      },
    ],
    deliverableIdToWbsId: new Map([
      [dA, 2],
      [dB, 3],
    ]),
    wbs_nodes: [
      { kind: "DELIVERABLE", wbs_id: 2, parent_wbs_id: 1, wbs_short_name: "2", wbs_name: "Package A" },
      { kind: "DELIVERABLE", wbs_id: 3, parent_wbs_id: 1, wbs_short_name: "3", wbs_name: "Package B" },
    ],
  };

  const x = mapToXER(wbs);
  if (x.projwbs.length !== 3) {
    throw new Error(`expected 3 PROJWBS rows, got ${x.projwbs.length}`);
  }
  const [root, wbsA, wbsB] = x.projwbs;
  if (
    root.parent_wbs_id !== null ||
    root.proj_id !== "P6-100" ||
    root.wbs_id !== "1" ||
    root.wbs_short_name !== "1"
  ) {
    throw new Error(`root row wrong: ${JSON.stringify(root)}`);
  }
  if (
    wbsA.parent_wbs_id !== "1" ||
    wbsA.wbs_id !== "2" ||
    wbsA.wbs_short_name !== "2" ||
    wbsA.wbs_name !== "Package A"
  ) {
    throw new Error(`deliverable A row wrong: ${JSON.stringify(wbsA)}`);
  }
  if (wbsB.wbs_id !== "3" || wbsB.wbs_short_name !== "3" || wbsB.wbs_name !== "Package B" || wbsB.proj_id !== "P6-100") {
    throw new Error(`deliverable B row wrong: ${JSON.stringify(wbsB)}`);
  }

  if (x.tasks.length !== 3) {
    throw new Error(`expected 3 TASK rows, got ${x.tasks.length}`);
  }
  const byTask = new Map(x.tasks.map((t) => [t.task_id, t.wbs_id]));
  if (byTask.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") !== "2") {
    throw new Error("activity A not under deliverable A WBS");
  }
  if (byTask.get("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") !== "3" || byTask.get("cccccccc-cccc-4ccc-8ccc-cccccccccccc") !== "3") {
    throw new Error("activity B rows not under deliverable B WBS");
  }

  const empty: GeneratedWbs = {
    project_wbs: { wbs_id: 1, wbs_short_name: "1", wbs_name: "Project" },
    deliverable_wbs_list: [],
    deliverableIdToWbsId: new Map(),
    wbs_nodes: [],
  };
  const x0 = mapToXER(empty);
  const r0 = x0.projwbs[0];
  if (x0.projwbs.length !== 1 || x0.tasks.length !== 0 || !r0 || r0.proj_id !== "1" || r0.wbs_id !== "1") {
    throw new Error(`empty WBS map wrong: ${JSON.stringify(x0)}`);
  }

  console.log("wbs-stage4-smoke: all checks passed.");
}

main();
