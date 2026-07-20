import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const rows = await prisma.project.findMany({
    where: {
      OR: [
        { name: { contains: "Northvale", mode: "insensitive" } },
        { name: { contains: "Emergency Care", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, companyId: true, archivedAt: true },
    orderBy: { name: "asc" },
  });
  console.log(JSON.stringify(rows, null, 2));

  for (const row of rows) {
    const count = await prisma.deliverable.count({ where: { projectId: row.id } });
    const snapshots = await prisma.programmeSnapshot.count({ where: { projectId: row.id } });
    console.log(`  ${row.name}: deliverables=${count}, snapshots=${snapshots}`);
  }
} finally {
  await prisma.$disconnect();
}
