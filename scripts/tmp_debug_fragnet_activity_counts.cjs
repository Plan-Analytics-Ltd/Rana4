const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const fragnets = await prisma.fragnet.findMany({ select: { id: true, name: true } });
    const delivs = await prisma.deliverable
      .groupBy({ by: ["fragnetId"], _count: { _all: true } })
      .catch(() => []);
    const acts = await prisma.activity
      .groupBy({ by: ["fragnetId"], _count: { _all: true } })
      .catch(() => []);

    const delivCount = new Map(delivs.map((x) => [x.fragnetId ?? "__NULL__", x._count._all]));
    const actCount = new Map(acts.map((x) => [x.fragnetId ?? "__NULL__", x._count._all]));

    const rows = fragnets
      .map((f) => ({
        fragnetId: f.id,
        name: f.name,
        deliverables: delivCount.get(f.id) || 0,
        activities: actCount.get(f.id) || 0,
      }))
      .sort(
        (a, b) =>
          b.activities - a.activities || b.deliverables - a.deliverables || a.name.localeCompare(b.name)
      );

    console.log(JSON.stringify(rows, null, 2));
    console.log("unassigned deliverables (fragnetId null):", delivCount.get("__NULL__") || 0);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

