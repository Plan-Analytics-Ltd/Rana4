/**
 * Stage 7 smoke: WBS export validation + unique deliverable WBS names.
 * Run: npm run test:wbs-stage7
 */
import type { Activity } from "@prisma/client";
import "dotenv/config";
import { prisma } from "../src/utils/prisma.js";
import { runWithAuthContextAsync } from "../src/utils/requestContext.js";
import { buildWbsFromDeliverables, withUniqueDeliverableWbsNames } from "../src/services/wbsGenerate.service.js";
import {
  validateFragnetForWbsExport,
  validateGeneratedWbsStructure,
} from "../src/services/wbsExportValidation.service.js";

function mainUnit(): void {
  const orphanIssues = validateFragnetForWbsExport({
    id: "frag-1",
    deliverables: [{ id: "d1", fragnetId: "frag-1" }],
    activities: [{ id: "a1", name: "Lonely", deliverableId: "missing-deliverable" }],
  });
  if (orphanIssues.length !== 1 || orphanIssues[0]!.code !== "ORPHAN_ACTIVITY") {
    throw new Error(`expected ORPHAN_ACTIVITY, got ${JSON.stringify(orphanIssues)}`);
  }

  const missingIssues = validateFragnetForWbsExport({
    id: "frag-1",
    deliverables: [{ id: "d1", fragnetId: "frag-1" }],
    activities: [{ id: "a1", name: "X", deliverableId: "   " }],
  });
  if (missingIssues.length !== 1 || missingIssues[0]!.code !== "ACTIVITY_MISSING_DELIVERABLE") {
    throw new Error(`expected ACTIVITY_MISSING_DELIVERABLE, got ${JSON.stringify(missingIssues)}`);
  }

  const wbsBad = withUniqueDeliverableWbsNames({
    project_wbs: { wbs_id: 1, wbs_short_name: "1", wbs_name: "P" },
    deliverable_wbs_list: [
      {
        deliverable_id: "d1",
        wbs_id: 2,
        wbs_short_name: "2",
        wbs_name: "Slice",
        activities: [{ id: "a1", deliverableId: "d2" } as Activity],
      },
    ],
    deliverableIdToWbsId: new Map([["d1", 2]]),
  });
  const mismatch = validateGeneratedWbsStructure(wbsBad);
  if (mismatch.length !== 1 || mismatch[0]!.code !== "ACTIVITY_DELIVERABLE_MISMATCH") {
    throw new Error(`expected ACTIVITY_DELIVERABLE_MISMATCH, got ${JSON.stringify(mismatch)}`);
  }

  const wbsDup = withUniqueDeliverableWbsNames({
    project_wbs: { wbs_id: 1, wbs_short_name: "1", wbs_name: "X" },
    deliverable_wbs_list: [
      { deliverable_id: "1", wbs_id: 2, wbs_short_name: "2", wbs_name: "Same", activities: [] },
      { deliverable_id: "2", wbs_id: 3, wbs_short_name: "3", wbs_name: "Same", activities: [] },
      { deliverable_id: "3", wbs_id: 4, wbs_short_name: "4", wbs_name: "same", activities: [] },
    ],
    deliverableIdToWbsId: new Map([
      ["1", 2],
      ["2", 3],
      ["3", 4],
    ]),
  });
  const names = wbsDup.deliverable_wbs_list.map((s) => s.wbs_name);
  if (names[0] !== "Same" || names[1] !== "Same (2)" || names[2] !== "same (3)") {
    throw new Error(`unique names expected, got ${JSON.stringify(names)}`);
  }
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) {
    throw new Error("WBS names must be unique case-insensitively");
  }
}

const TAG = `wbs-stage7-${Date.now()}`;

async function mainDb(): Promise<void> {
  const company = await prisma.company.create({
    data: {
      name: `wbs-stage7 ${TAG}`,
      joinCode: `JS7${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
    },
  });
  const user = await prisma.user.create({
    data: { email: `wbs7_${Date.now()}@test.local`, passwordHash: "x", name: "wbs-stage7", companyId: company.id },
  });

  try {
    await runWithAuthContextAsync({ userId: user.id, companyId: company.id }, async () => {
      const project = await prisma.project.create({ data: { name: `P ${TAG}`, companyId: company.id } });
      const standard = await prisma.standard.create({
        data: { name: `S7 ${TAG}`, description: "wbs-stage7-smoke", projectId: project.id },
      });
      const fragnet = await prisma.fragnet.create({
        data: { standardId: standard.id, name: "F", description: null, projectId: project.id },
      });
      const d1 = await prisma.deliverable.create({
        data: { name: "Twin", projectId: project.id, externalProjectId: TAG, bestDuration: 1, likelyDuration: 1, fragnetId: fragnet.id },
      });
      const d2 = await prisma.deliverable.create({
        data: { name: "Twin", projectId: project.id, externalProjectId: TAG, bestDuration: 1, likelyDuration: 1, fragnetId: fragnet.id },
      });
      await prisma.activity.create({
        data: {
          fragnetId: fragnet.id,
          deliverableId: d1.id,
          activityCode: "T1",
          name: "One",
          bestDuration: 1,
          likelyDuration: 1,
          projectId: project.id,
        },
      });
      await prisma.activity.create({
        data: {
          fragnetId: fragnet.id,
          deliverableId: d2.id,
          activityCode: "T2",
          name: "Two",
          bestDuration: 1,
          likelyDuration: 1,
          projectId: project.id,
        },
      });

      const loaded = await prisma.deliverable.findMany({
        where: { fragnetId: fragnet.id },
        include: { activities: { orderBy: [{ activityCode: "asc" }, { id: "asc" }] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const wbs = buildWbsFromDeliverables("P7", loaded);
      const n0 = wbs.deliverable_wbs_list[0]?.wbs_name;
      const n1 = wbs.deliverable_wbs_list[1]?.wbs_name;
      if (n0 !== "Twin" || n1 !== "Twin (2)") {
        throw new Error(`DB duplicate deliverable names: expected Twin / Twin (2), got ${n0} / ${n1}`);
      }
      const f = await prisma.fragnet.findUniqueOrThrow({
        where: { id: fragnet.id },
        include: { activities: true, deliverables: true },
      });
      const okIssues = validateFragnetForWbsExport(f);
      if (okIssues.length !== 0) {
        throw new Error(`valid fragnet should have no issues, got ${JSON.stringify(okIssues)}`);
      }

      await prisma.standard.delete({ where: { id: standard.id } });
    });
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
}

async function main(): Promise<void> {
  mainUnit();
  await mainDb();
  console.log("wbs-stage7-smoke: all checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
