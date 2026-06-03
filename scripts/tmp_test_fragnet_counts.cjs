const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const fragnets = await prisma.fragnet.findMany({
      where: { name: { contains: "test", mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        project: { select: { name: true } },
        _count: { select: { deliverables: true, activities: true } },
      },
      orderBy: [{ project: { name: "asc" } }, { name: "asc" }],
    });
    if (fragnets.length === 0) {
      console.log("No fragnets matching 'test' found.");
      return;
    }
    for (const f of fragnets) {
      console.log(`Project: ${f.project.name}`);
      console.log(`Fragnet: ${f.name}`);
      console.log(`fragnetId: ${f.id}`);
      console.log(`Deliverables: ${f._count.deliverables}`);
      console.log(`Activities: ${f._count.activities}`);
      const acts = await prisma.activity.findMany({
        where: { fragnetId: f.id },
        orderBy: { activityCode: "asc" },
        select: { activityCode: true, name: true, isSharedAcrossDeliverables: true },
      });
      if (acts.length > 0) {
        console.log("Rows:", acts.map((a) => `${a.activityCode} ${a.name}${a.isSharedAcrossDeliverables ? " [shared]" : ""}`).join(", "));
      }
      console.log("---");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
