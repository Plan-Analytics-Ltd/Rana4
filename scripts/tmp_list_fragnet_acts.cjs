const { PrismaClient } = require("@prisma/client");
const id = "7f8e7e2d-5eec-4568-a605-19b57c4165fa";
const p = new PrismaClient();
p.activity
  .findMany({ where: { fragnetId: id }, select: { activityCode: true, name: true }, orderBy: { activityCode: "asc" } })
  .then((acts) => {
    console.log("count", acts.length);
    for (const a of acts) console.log(a.activityCode, a.name);
  })
  .finally(() => p.$disconnect());
