const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const fragnets = await prisma.fragnet.findMany({
      where: { name: { in: ["RIBA 2", "RIBA 3"] } },
      select: {
        id: true,
        name: true,
        projectId: true,
        companyId: true,
        project: { select: { name: true } },
        _count: { select: { activities: true } },
      },
      orderBy: [{ project: { name: "asc" } }, { name: "asc" }],
    });

    for (const f of fragnets) {
      const apiRows = await prisma.activity.findMany({
        where: { fragnetId: f.id, companyId: f.companyId },
        orderBy: { activityCode: "asc" },
        select: {
          id: true,
          activityCode: true,
          name: true,
          isSharedAcrossDeliverables: true,
        },
      });
      console.log("---");
      console.log(`Fragnet: ${f.name} | Project: ${f.project?.name ?? f.projectId}`);
      console.log(`fragnetId: ${f.id}`);
      console.log(`DB activities table rows (fragnet_id): ${f._count.activities}`);
      console.log(`Activities API equivalent (GET /activities/fragnet/:id): ${apiRows.length}`);
      console.log(
        "Activities:",
        apiRows
          .map(
            (a) =>
              `${a.activityCode} ${a.name}${a.isSharedAcrossDeliverables ? " [shared]" : ""}`
          )
          .join(", ") || "(none)"
      );
    }

    const total2 = await prisma.activity.count({ where: { fragnet: { name: "RIBA 2" } } });
    const total3 = await prisma.activity.count({ where: { fragnet: { name: "RIBA 3" } } });
    console.log("\n=== Totals across ALL projects (fragnet name match) ===");
    console.log("RIBA 2 — activities table rows:", total2);
    console.log("RIBA 3 — activities table rows:", total3);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
