/**
 * Backfill deliverable → first-activity FS links for a fragnet.
 * Run: node scripts/sync-deliverable-first-activity-fs.cjs [fragnetName]
 */
const { PrismaClient } = require("@prisma/client");

async function main() {
  const name = process.argv[2] ?? "Test Fragnet";
  const prisma = new PrismaClient();
  try {
    const fragnet = await prisma.fragnet.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        companyId: true,
        projectId: true,
        project: { select: { name: true } },
      },
    });
    if (!fragnet) {
      console.error("Fragnet not found:", name);
      process.exit(1);
    }
    const deliverables = await prisma.deliverable.findMany({
      where: { fragnetId: fragnet.id, companyId: fragnet.companyId },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    let linked = 0;
    for (const d of deliverables) {
      const first = await prisma.activity.findFirst({
        where: {
          companyId: fragnet.companyId,
          deliverableId: d.id,
          isSharedAcrossDeliverables: false,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, activityCode: true },
      });
      await prisma.deliverableActivityRelationship.deleteMany({
        where: {
          companyId: fragnet.companyId,
          predecessorDeliverableId: d.id,
          relationshipType: "FS",
        },
      });
      if (!first) {
        console.log(`  ${d.name}: (no activities)`);
        continue;
      }
      await prisma.deliverableActivityRelationship.create({
        data: {
          fragnetId: fragnet.id,
          predecessorDeliverableId: d.id,
          successorActivityId: first.id,
          relationshipType: "FS",
          lag: 0,
          projectId: fragnet.projectId,
          companyId: fragnet.companyId,
        },
      });
      linked++;
      console.log(`  ${d.name} → FS → ${first.activityCode} ${first.name}`);
    }
    console.log(`\n${fragnet.project.name} / ${fragnet.name}: ${linked} deliverable link(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
