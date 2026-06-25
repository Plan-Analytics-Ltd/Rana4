const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const fragnets = await prisma.fragnet.findMany({
      where: { name: "RIBA 3" },
      select: {
        id: true,
        name: true,
        projectId: true,
        project: { select: { name: true } },
        _count: { select: { deliverables: true } },
      },
      orderBy: { project: { name: "asc" } },
    });
    for (const f of fragnets) {
      console.log(`${f.project?.name} | fragnetId: ${f.id} | deliverables: ${f._count.deliverables}`);
    }
    const total = await prisma.deliverable.count({ where: { fragnet: { name: "RIBA 3" } } });
    console.log(`\nTotal deliverables (all RIBA 3 fragnets): ${total}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
