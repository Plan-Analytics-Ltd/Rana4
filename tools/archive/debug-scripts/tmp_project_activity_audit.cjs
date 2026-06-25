const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const project = await p.project.findFirst({
    where: { name: "test" },
    select: { id: true, name: true },
  });
  if (!project) {
    console.log("no test project");
    return;
  }
  const total = await p.activity.count({ where: { projectId: project.id } });
  const byName = await p.activity.groupBy({
    by: ["name"],
    where: { projectId: project.id },
    _count: true,
  });
  console.log("project", project.name, "total activities", total);
  for (const row of byName.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${row.name}: ${row._count}`);
  }
}
main().finally(() => p.$disconnect());
