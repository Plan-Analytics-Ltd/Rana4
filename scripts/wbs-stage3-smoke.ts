/**
 * Stage 3 smoke: generateWBS / buildWbsForFragnetExport (no HTTP).
 * Run: npm run test:wbs-stage3
 * Requires DATABASE_URL and migrations through Stage 1.
 */
import "dotenv/config";
import { prisma } from "../src/utils/prisma.js";
import { runWithAuthContextAsync } from "../src/utils/requestContext.js";
import { buildWbsForFragnetExport, generateWBS } from "../src/services/wbsGenerate.service.js";

const TAG = `wbs-stage3-${Date.now()}`;

async function main(): Promise<void> {
  const empty = await generateWBS("   ");
  if (empty.deliverable_wbs_list.length !== 0 || empty.project_wbs.wbs_id !== 1 || empty.project_wbs.wbs_short_name !== "1") {
    throw new Error(`generateWBS(blank): unexpected ${JSON.stringify(empty)}`);
  }

  const company = await prisma.company.create({
    data: {
      name: `wbs-stage3 ${TAG}`,
      joinCode: `JS3${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
    },
  });
  const user = await prisma.user.create({
    data: { email: `wbs3_${Date.now()}@test.local`, passwordHash: "x", name: "wbs-stage3", companyId: company.id },
  });

  try {
    await runWithAuthContextAsync({ userId: user.id, companyId: company.id }, async () => {
      const project = await prisma.project.create({ data: { name: `P ${TAG}`, companyId: company.id } });
      const standard = await prisma.standard.create({
        data: { name: `S3 ${TAG}`, description: "wbs-stage3-smoke", projectId: project.id },
      });
      const fragnet = await prisma.fragnet.create({
        data: { standardId: standard.id, name: "F", description: null, projectId: project.id },
      });

      const dAlpha = await prisma.deliverable.create({
        data: {
          name: "Alpha",
          projectId: project.id,
          externalProjectId: TAG,
          bestDuration: 1,
          likelyDuration: 1,
          fragnetId: fragnet.id,
        },
      });
      const dBeta = await prisma.deliverable.create({
        data: {
          name: "Beta",
          projectId: project.id,
          externalProjectId: TAG,
          bestDuration: 1,
          likelyDuration: 1,
          fragnetId: fragnet.id,
        },
      });

      await prisma.activity.create({
        data: {
          fragnetId: fragnet.id,
          deliverableId: dAlpha.id,
          activityCode: "A1",
          name: "Only Alpha",
          bestDuration: 1,
          likelyDuration: 1,
          projectId: project.id,
        },
      });
      await prisma.activity.create({
        data: {
          fragnetId: fragnet.id,
          deliverableId: dBeta.id,
          activityCode: "B1",
          name: "Only Beta",
          bestDuration: 1,
          likelyDuration: 1,
          projectId: project.id,
        },
      });
      await prisma.activity.create({
        data: {
          fragnetId: fragnet.id,
          deliverableId: dBeta.id,
          activityCode: "B2",
          name: "Second Beta",
          bestDuration: 1,
          likelyDuration: 1,
          projectId: project.id,
        },
      });

      const loaded = await prisma.deliverable.findMany({
        where: { externalProjectId: TAG },
        include: { activities: { orderBy: [{ activityCode: "asc" }, { id: "asc" }] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const built = buildWbsForFragnetExport(TAG, { id: fragnet.id, name: fragnet.name }, loaded);
      if (built.project_wbs.wbs_id !== 1 || built.project_wbs.wbs_short_name !== "1" || built.project_wbs.wbs_name !== TAG) {
        throw new Error(`buildWbsForFragnetExport root: ${JSON.stringify(built.project_wbs)}`);
      }
      if (built.deliverable_wbs_list.length !== 2) {
        throw new Error(`expected 2 deliverable slices, got ${built.deliverable_wbs_list.length}`);
      }
      const alphaSlice = built.deliverable_wbs_list.find((s) => s.deliverable_id === dAlpha.id);
      const betaSlice = built.deliverable_wbs_list.find((s) => s.deliverable_id === dBeta.id);
      if (!alphaSlice || alphaSlice.activities.length !== 1 || alphaSlice.wbs_name !== "Alpha" || alphaSlice.wbs_id !== 3 || alphaSlice.wbs_short_name !== "3") {
        throw new Error("Alpha slice mismatch");
      }
      if (!betaSlice || betaSlice.activities.length !== 2 || betaSlice.wbs_name !== "Beta" || betaSlice.wbs_id !== 4 || betaSlice.wbs_short_name !== "4") {
        throw new Error("Beta slice mismatch");
      }

      const fromFn = await generateWBS(TAG);
      if (JSON.stringify(fromFn.deliverable_wbs_list.map((s) => s.deliverable_id).sort()) !==
          JSON.stringify([dAlpha.id, dBeta.id].sort())) {
        throw new Error("generateWBS deliverable ids mismatch");
      }

      await prisma.standard.delete({ where: { id: standard.id } });
    });

    console.log("wbs-stage3-smoke: all checks passed.");
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
