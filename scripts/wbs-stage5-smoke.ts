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
  const empty = await generateXERFile({ mode: "FRAGNET", projectId: "   " });
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

  let projectIdToDelete: string | null = null;

  try {
    await runWithAuthContextAsync({ userId: user.id, companyId: company.id }, async () => {
      const project = await prisma.project.create({ data: { name: `P ${TAG}`, companyId: company.id } });
      projectIdToDelete = project.id;
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

      const xer = await generateXERFile({ mode: "FRAGNET", projectId: TAG });
      if (xer.includes("%T\tTASK")) {
        throw new Error("XER should not embed TASK table (activities export via spreadsheet only)");
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
      if (!act.id) {
        throw new Error("activity create failed");
      }

      await prisma.standard.delete({ where: { id: standard.id } });
      await prisma.project.delete({ where: { id: project.id } });
    });

    console.log("wbs-stage5-smoke: all checks passed.");
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    if (projectIdToDelete) {
      await runWithAuthContextAsync({ userId: user.id, companyId: company.id }, async () => {
        await prisma.project.deleteMany({ where: { id: projectIdToDelete } });
      });
    }
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
