/**
 * Stage 6 smoke: TASK sheet uses deliverable-derived WBS (not RANA4-WBS).
 * Run: npm run test:wbs-stage6
 */
import "dotenv/config";
import * as XLSX from "xlsx";
import { prisma } from "../src/utils/prisma.js";
import { runWithAuthContextAsync } from "../src/utils/requestContext.js";
import { assignmentsFromDb } from "../src/services/rateCard.js";
import type { DeliverableWithActivities } from "../src/services/deliverableActivityLink.service.js";
import { buildWbsForFragnetExport } from "../src/services/wbsGenerate.service.js";
import { buildXerAlignedWbsCodeMap } from "../src/services/wbsHumanReadable.service.js";
import { generateFragnetXlsx } from "../src/services/export.service.js";

const TAG = `wbs-stage6-${Date.now()}`;

async function main(): Promise<void> {
  const company = await prisma.company.create({
    data: {
      name: `wbs-stage6 ${TAG}`,
      joinCode: `JS6${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
    },
  });
  const user = await prisma.user.create({
    data: { email: `wbs6_${Date.now()}@test.local`, passwordHash: "x", name: "wbs-stage6", companyId: company.id },
  });

  try {
    await runWithAuthContextAsync({ userId: user.id, companyId: company.id }, async () => {
      const project = await prisma.project.create({ data: { name: `P ${TAG}`, companyId: company.id } });
      const standard = await prisma.standard.create({
        data: { name: `S6 ${TAG}`, description: "wbs-stage6-export-smoke", projectId: project.id },
      });
      const fragnet = await prisma.fragnet.create({
        data: { standardId: standard.id, name: "F", description: null, projectId: project.id },
      });
      const del = await prisma.deliverable.create({
        data: {
          name: "ExportPkg",
          projectId: project.id,
          externalProjectId: TAG,
          bestDuration: 2,
          likelyDuration: 3,
          fragnetId: fragnet.id,
        },
      });
      await prisma.activity.create({
        data: {
          fragnetId: fragnet.id,
          deliverableId: del.id,
          activityCode: "Z1",
          name: "Act1",
          bestDuration: 1,
          likelyDuration: 1,
          projectId: project.id,
        },
      });

      const f = await prisma.fragnet.findUniqueOrThrow({
        where: { id: fragnet.id },
        include: {
          activities: { orderBy: { createdAt: "asc" } },
          relationships: true,
          deliverables: { orderBy: { createdAt: "asc" } },
        },
      });

  const deliverablesForExport = await Promise.all(
    f.deliverables.map(async (d) => ({
      id: d.id,
      name: d.name,
      bestDuration: d.bestDuration,
      likelyDuration: d.likelyDuration,
      createdAt: d.createdAt,
      assignedResources: await assignmentsFromDb(company.id, d.assignedResources),
    }))
  );
  const activitiesForExport = await Promise.all(
    f.activities.map(async (a) => ({
      id: a.id,
      deliverableId: a.deliverableId,
      name: a.name,
      bestDuration: a.bestDuration,
      likelyDuration: a.likelyDuration,
      createdAt: a.createdAt,
      assignedResources: await assignmentsFromDb(company.id, a.assignedResources),
    }))
  );
  const deliverablesWithActivities: DeliverableWithActivities[] = f.deliverables.map((d) => ({
    ...d,
    activities: f.activities
      .filter((a) => a.deliverableId === d.id)
      .sort((a, b) => {
        const c = a.activityCode.localeCompare(b.activityCode);
        if (c !== 0) return c;
        return a.id.localeCompare(b.id);
      }),
  }));
  const generatedWbs = buildWbsForFragnetExport("Stage6 Project", { id: f.id, name: f.name }, deliverablesWithActivities);
  const wbsCodeById = buildXerAlignedWbsCodeMap(generatedWbs, "PROJ-6");
  const leafId = generatedWbs.deliverable_wbs_list[0]?.wbs_id;
  const expectedWbsCode = leafId !== undefined ? wbsCodeById.get(leafId) : undefined;
  if (!expectedWbsCode) {
    throw new Error("missing hierarchical WBS code for deliverable leaf");
  }

  const { buffer: buf } = await generateFragnetXlsx(
    generatedWbs,
    deliverablesForExport,
    activitiesForExport,
    f.relationships.map((r) => ({
      predecessorActivityId: r.predecessorActivityId,
      successorActivityId: r.successorActivityId,
      relationshipType: r.relationshipType,
      lag: r.lag,
    })),
    "best",
    "PROJ-6",
    "PROJ-6",
    [],
    undefined
  );

  const wb = XLSX.read(buf, { type: "buffer" });
  const taskSheet = wb.Sheets["TASK"];
  if (!taskSheet) throw new Error("missing TASK sheet");
  const rows = XLSX.utils.sheet_to_json(taskSheet, { header: 1 }) as (string | number | null)[][];
  if (rows.length < 3) throw new Error("TASK sheet missing data rows");
  const wbsIds = rows.slice(2).map((r) => String(r[2] ?? ""));
  if (wbsIds.some((id) => id === "RANA4-WBS")) {
    throw new Error("flat RANA4-WBS must not appear after WBS integration");
  }
  if (!wbsIds.every((id) => id === expectedWbsCode)) {
    throw new Error(`expected all wbs_id ${expectedWbsCode}, got ${JSON.stringify(wbsIds)}`);
  }
  const wbsNames = rows.slice(2).map((r) => String(r[3] ?? ""));
  if (!wbsNames.every((n) => n === "ExportPkg")) {
    throw new Error(`expected wbs_name ExportPkg on all TASK rows, got ${JSON.stringify(wbsNames)}`);
  }

      await prisma.standard.delete({ where: { id: standard.id } });
    });

    console.log("wbs-stage6-export-smoke: all checks passed.");
  } finally {
    // Ensure scoped models are deleted under a valid company context.
    await runWithAuthContextAsync({ userId: user.id, companyId: company.id }, async () => {
      await prisma.standard.deleteMany({ where: { companyId: company.id } });
      await prisma.project.deleteMany({ where: { companyId: company.id } });
    });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
