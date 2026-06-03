/**
 * Remove activity→activity FS links where both activities share the same deliverable
 * (auto chain links — not deliverable→first-activity).
 * Run: node scripts/remove-same-deliverable-activity-links.cjs [fragnetName]
 */
const { PrismaClient } = require("@prisma/client");

async function main() {
  const name = process.argv[2] ?? "Test Fragnet";
  const prisma = new PrismaClient();
  try {
    const fragnet = await prisma.fragnet.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true, companyId: true, name: true },
    });
    if (!fragnet) {
      console.error("Fragnet not found:", name);
      process.exit(1);
    }
    const rels = await prisma.relationship.findMany({
      where: { fragnetId: fragnet.id, companyId: fragnet.companyId },
      select: { id: true, predecessorActivityId: true, successorActivityId: true },
    });
    let removed = 0;
    for (const r of rels) {
      const pred = await prisma.activity.findUnique({
        where: { id: r.predecessorActivityId },
        select: { deliverableId: true, activityCode: true, name: true },
      });
      const succ = await prisma.activity.findUnique({
        where: { id: r.successorActivityId },
        select: { deliverableId: true, activityCode: true, name: true },
      });
      if (pred?.deliverableId && pred.deliverableId === succ?.deliverableId) {
        await prisma.relationship.delete({ where: { id: r.id } });
        removed++;
        console.log(`  removed ${pred.activityCode} ${pred.name} → ${succ.activityCode} ${succ.name}`);
      }
    }
    console.log(`\n${fragnet.name}: removed ${removed} same-deliverable activity link(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
