const { prisma } = require("./dist/utils/prisma.js");
(async () => {
  const rows = await prisma.$queryRawUnsafe("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='activities' ORDER BY indexname");
  console.log(rows);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
