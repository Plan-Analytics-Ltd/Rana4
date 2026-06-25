const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const totalActivities = await prisma.activity.count();
    const sharedActivities = await prisma.activity.count({ where: { isSharedAcrossDeliverables: true } });
    const templatesTotal = await prisma.fragnetActivityTemplate.count();
    const templatesShared = await prisma.fragnetActivityTemplate.count({
      where: { isSharedAcrossDeliverables: true },
    });
    const templateRels = await prisma.fragnetTemplateRelationship.count();

    console.log(
      JSON.stringify(
        {
          totalActivities,
          sharedActivities,
          templatesTotal,
          templatesShared,
          templateRelationshipCount: templateRels,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

