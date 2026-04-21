/**
 * Stage 2 smoke: deliverable–activity link helpers (no HTTP server).
 * Run: npm run test:wbs-stage2
 * Requires DATABASE_URL and applied migrations (incl. Stage 1).
 */
import "dotenv/config";
import { prisma } from "../src/utils/prisma.js";
import { runWithAuthContextAsync } from "../src/utils/requestContext.js";
import {
  assertDeliverableOnFragnet,
  getActivitiesByDeliverable,
  getDeliverablesWithActivities,
} from "../src/services/deliverableActivityLink.service.js";

const PROJECT_TAG = `wbs-stage2-${Date.now()}`;

async function main(): Promise<void> {
  const company = await prisma.company.create({
    data: {
      name: `wbs-stage2 ${PROJECT_TAG}`,
      joinCode: `JS2${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
    },
  });
  const user = await prisma.user.create({
    data: { email: `wbs2_${Date.now()}@test.local`, passwordHash: "x", name: "wbs-stage2", companyId: company.id },
  });

  try {
    await runWithAuthContextAsync({ userId: user.id, companyId: company.id }, async () => {
      const project = await prisma.project.create({ data: { name: `P ${PROJECT_TAG}`, companyId: company.id } });
      const standard = await prisma.standard.create({
        data: { name: `Stage2 ${PROJECT_TAG}`, description: "wbs-stage2-smoke", projectId: project.id },
      });
      const fragnet = await prisma.fragnet.create({
        data: { standardId: standard.id, name: "F", description: null, projectId: project.id },
      });
      const otherFragnet = await prisma.fragnet.create({
        data: { standardId: standard.id, name: "F2", description: null, projectId: project.id },
      });

      const d1 = await prisma.deliverable.create({
        data: {
          name: "D1",
          projectId: project.id,
          externalProjectId: PROJECT_TAG,
          bestDuration: 1,
          likelyDuration: 1,
          fragnetId: fragnet.id,
        },
      });
      const d2 = await prisma.deliverable.create({
        data: {
          name: "D2",
          projectId: project.id,
          externalProjectId: PROJECT_TAG,
          bestDuration: 1,
          likelyDuration: 1,
          fragnetId: fragnet.id,
        },
      });
      const dOther = await prisma.deliverable.create({
        data: {
          name: "D-Other-Fragnet",
          projectId: project.id,
          externalProjectId: PROJECT_TAG,
          bestDuration: 1,
          likelyDuration: 1,
          fragnetId: otherFragnet.id,
        },
      });

      await prisma.activity.create({
        data: {
          fragnetId: fragnet.id,
          deliverableId: d1.id,
          activityCode: "A1",
          name: "On D1",
          bestDuration: 1,
          likelyDuration: 1,
          projectId: project.id,
        },
      });
      await prisma.activity.create({
        data: {
          fragnetId: fragnet.id,
          deliverableId: d2.id,
          activityCode: "A2",
          name: "On D2",
          bestDuration: 1,
          likelyDuration: 1,
          projectId: project.id,
        },
      });

      const byD1 = await getActivitiesByDeliverable(d1.id);
      if (byD1.length !== 1 || byD1[0]!.activityCode !== "A1") {
        throw new Error(`getActivitiesByDeliverable: expected one activity A1, got ${JSON.stringify(byD1)}`);
      }

      const withActs = await getDeliverablesWithActivities(PROJECT_TAG);
      if (withActs.length !== 3) {
        throw new Error(`getDeliverablesWithActivities: expected 3 deliverables, got ${withActs.length}`);
      }
      const d1Row = withActs.find((d) => d.id === d1.id);
      if (!d1Row || d1Row.activities.length !== 1) {
        throw new Error("getDeliverablesWithActivities: D1 should include 1 activity");
      }

      const ok = await assertDeliverableOnFragnet(fragnet.id, d1.id);
      if (!ok.ok) throw new Error("assertDeliverableOnFragnet should succeed for D1 on same fragnet");

      const wrong = await assertDeliverableOnFragnet(fragnet.id, dOther.id);
      if (wrong.ok || wrong.mismatch.kind !== "wrong_fragnet") {
        throw new Error("assertDeliverableOnFragnet should fail wrong_fragnet for deliverable on other fragnet");
      }

      const missing = await assertDeliverableOnFragnet(fragnet.id, "00000000-0000-0000-0000-000000000000");
      if (missing.ok || missing.mismatch.kind !== "not_found") {
        throw new Error("assertDeliverableOnFragnet should fail not_found for bogus id");
      }

      const emptyProject = await getDeliverablesWithActivities("   ");
      if (emptyProject.length !== 0) {
        throw new Error("getDeliverablesWithActivities('') should return []");
      }

      await prisma.standard.delete({ where: { id: standard.id } });
    });

    console.log("wbs-stage2-smoke: all checks passed.");
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
