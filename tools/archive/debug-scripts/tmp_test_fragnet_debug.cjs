const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const f = await prisma.fragnet.findFirst({
      where: { name: { contains: "Test Fragnet", mode: "insensitive" } },
      include: {
        project: { select: { name: true } },
        activityTemplates: {
          orderBy: [{ orderIndex: "asc" }, { templateCode: "asc" }],
          select: {
            id: true,
            name: true,
            templateCode: true,
            isSharedAcrossDeliverables: true,
          },
        },
        activities: {
          select: {
            id: true,
            activityCode: true,
            name: true,
            deliverableId: true,
            templateActivityId: true,
            isSharedAcrossDeliverables: true,
          },
        },
        deliverables: { select: { id: true, name: true } },
      },
    });
    if (!f) {
      console.log("Test Fragnet not found");
      return;
    }
    console.log("Project:", f.project.name);
    console.log("Fragnet:", f.name, f.id);
    console.log("Deliverables:", f.deliverables.length);
    console.log("Templates:", f.activityTemplates.length);
    console.log(JSON.stringify(f.activityTemplates, null, 2));
    console.log("Activities:", f.activities.length);
    console.log(JSON.stringify(f.activities, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
