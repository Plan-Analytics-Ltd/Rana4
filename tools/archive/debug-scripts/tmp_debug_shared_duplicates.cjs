const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.activity.findMany({
      where: { isSharedAcrossDeliverables: true },
      select: { id: true, fragnetId: true, projectId: true, companyId: true, name: true, templateActivityId: true, activityCode: true },
      orderBy: [{ fragnetId: "asc" }, { name: "asc" }, { createdAt: "asc" }],
    });

    const byKey = new Map();
    for (const a of rows) {
      const key = `${a.companyId}||${a.projectId}||${a.fragnetId}||${a.templateActivityId ?? "NONE"}||${a.name.trim()}`;
      const list = byKey.get(key) ?? [];
      list.push({ id: a.id, code: a.activityCode });
      byKey.set(key, list);
    }

    const dups = [];
    for (const [key, list] of byKey.entries()) {
      if (list.length > 1) dups.push({ key, count: list.length, activities: list });
    }

    console.log(JSON.stringify({ totalShared: rows.length, duplicateKeys: dups.length, dups: dups.slice(0, 50) }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

