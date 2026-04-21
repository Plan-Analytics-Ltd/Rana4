/**
 * Stage 5 smoke: generateXERFile (needs DB + migrations through Stage 1).
 * Run: npm run test:wbs-stage5
 */
import "dotenv/config";
import { prisma } from "../src/utils/prisma.js";
import { runWithAuthContextAsync } from "../src/utils/requestContext.js";
import { generateXERFile } from "../src/services/xerFileGenerate.service.js";

const TAG = `wbs-stage5-${Date.now()}`;

async function main(): Promise<void> {
  const empty = await generateXERFile("   ");
  if (!empty.includes("ERMHDR") || !empty.includes("%T\tPROJWBS") || empty.includes("%T\tTASK")) {
    throw new Error("empty project XER should have ERMHDR + PROJWBS, no TASK table");
  }
  if (!empty.endsWith("%E\n")) {
    throw new Error("XER should end with %E line");
  }

  const company = await prisma.company.create({
    data: {
      name: `wbs-stage5 ${TAG}`,
      joinCode: `JS5${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
    },
  });
  const user = await prisma.user.create({
    data: { email: `wbs5_${Date.now()}@test.local`, passwordHash: "x", name: "wbs-stage5", companyId: company.id },
  });

  try {
    await runWithAuthContextAsync({ userId: user.id, companyId: company.id }, async () => {
      const project = await prisma.project.create({ data: { name: `P ${TAG}`, companyId: company.id } });
      const standard = await prisma.standard.create({
        data: { name: `S5 ${TAG}`, description: "wbs-stage5-smoke", projectId: project.id },
      });
      const fragnet = await prisma.fragnet.create({
        data: { standardId: standard.id, name: "F", description: null, projectId: project.id },
      });
      const del = await prisma.deliverable.create({
        data: {
          name: "Pkg",
          projectId: project.id,
          externalProjectId: TAG,
          bestDuration: 1,
          likelyDuration: 1,
          fragnetId: fragnet.id,
        },
      });
      const act = await prisma.activity.create({
        data: {
          fragnetId: fragnet.id,
          deliverableId: del.id,
          activityCode: "Z1",
          name: "Smoke task",
          bestDuration: 1,
          likelyDuration: 1,
          projectId: project.id,
        },
      });

      const xer = await generateXERFile(TAG);
      if (!xer.includes("%T\tTASK") || !xer.includes(act.id) || xer.includes("wbs-deliverable-")) {
        throw new Error("XER missing TASK/activity id or still contains UUID-style wbs-deliverable- ids");
      }
      const lines = xer.split("\n");
      const projwbsRow2 = lines.find((l) => l.startsWith("%R\t2\t"));
      if (!projwbsRow2) {
        throw new Error("XER PROJWBS missing numeric wbs_id row 2");
      }
      const p2 = projwbsRow2.split("\t");
      if (p2[5] !== "2" || p2[4] !== "Pkg") {
        throw new Error(`PROJWBS row 2 wbs_name/wbs_short_name: ${JSON.stringify(p2)}`);
      }
      const taskRow = lines.find((l) => l.startsWith("%R\t") && l.includes(act.id));
      if (!taskRow) {
        throw new Error("XER TASK row for activity not found");
      }
      const tCells = taskRow.split("\t");
      if (tCells[3] !== "2") {
        throw new Error(`TASK wbs_id should be numeric 2, got ${tCells[3]}`);
      }
      if (!xer.includes("\tTK_NotStart\t")) {
        throw new Error("XER missing default task status");
      }

      await prisma.standard.delete({ where: { id: standard.id } });
    });

    console.log("wbs-stage5-smoke: all checks passed.");
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
