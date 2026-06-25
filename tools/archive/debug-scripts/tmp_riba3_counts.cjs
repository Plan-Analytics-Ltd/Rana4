const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const fragnets = await prisma.fragnet.findMany({
      where: { name: "RIBA 3" },
      select: {
        id: true,
        project: { select: { name: true } },
        _count: { select: { deliverables: true, activities: true } },
      },
      orderBy: { project: { name: "asc" } },
    });
    for (const f of fragnets) {
      console.log(
        `${f.project.name} | deliverables: ${f._count.deliverables} | activities: ${f._count.activities}`
      );
    }
    const totalActs = await prisma.activity.count({ where: { fragnet: { name: "RIBA 3" } } });
    console.log(`\nTotal activities (all RIBA 3 fragnets): ${totalActs}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
