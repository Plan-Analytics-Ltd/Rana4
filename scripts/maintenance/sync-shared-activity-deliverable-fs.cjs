/**
 * Backfill shared activity → linked deliverable FS links.
 * Run: node scripts/sync-shared-activity-deliverable-fs.cjs [fragnetName]
 */
const { PrismaClient } = require("@prisma/client");

async function main() {
  const name = process.argv[2] ?? "Test Fragnet";
  const prisma = new PrismaClient();
  try {
    const fragnet = await prisma.fragnet.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true, companyId: true },
    });
    if (!fragnet) {
      console.error("Fragnet not found:", name);
      process.exit(1);
    }
    const shared = await prisma.activity.findMany({
      where: {
        fragnetId: fragnet.id,
        companyId: fragnet.companyId,
        isSharedAcrossDeliverables: true,
      },
      select: { id: true, activityCode: true, name: true, projectId: true },
    });
    let created = 0;
    for (const activity of shared) {
      const links = await prisma.activityDeliverable.findMany({
        where: { activityId: activity.id, companyId: fragnet.companyId },
        select: { deliverableId: true, deliverable: { select: { name: true } } },
      });
      await prisma.activityToDeliverableRelationship.deleteMany({
        where: {
          companyId: fragnet.companyId,
          predecessorActivityId: activity.id,
          relationshipType: "FS",
          ...(links.length > 0
            ? { successorDeliverableId: { notIn: links.map((l) => l.deliverableId) } }
            : {}),
        },
      });
      for (const link of links) {
        const existing = await prisma.activityToDeliverableRelationship.findFirst({
          where: {
            fragnetId: fragnet.id,
            predecessorActivityId: activity.id,
            successorDeliverableId: link.deliverableId,
            relationshipType: "FS",
          },
        });
        if (existing) continue;
        await prisma.activityToDeliverableRelationship.create({
          data: {
            fragnetId: fragnet.id,
            predecessorActivityId: activity.id,
            successorDeliverableId: link.deliverableId,
            relationshipType: "FS",
            lag: 0,
            projectId: activity.projectId,
            companyId: fragnet.companyId,
          },
        });
        created++;
        console.log(
          `  ${activity.activityCode} ${activity.name} → FS → ${link.deliverable.name}`
        );
      }
    }
    console.log(`\n${fragnet.name}: ${created} shared activity → deliverable link(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
