const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.fragnet
  .findFirst({
    where: { name: "Test Fragnet" },
    include: {
      _count: { select: { deliverables: true, activities: true, activityTemplates: true } },
    },
  })
  .then((f) => console.log(f ? JSON.stringify(f, null, 2) : "not found"))
  .finally(() => p.$disconnect());
