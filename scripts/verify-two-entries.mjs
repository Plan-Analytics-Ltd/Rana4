#!/usr/bin/env node
import { prisma } from "../dist/utils/prisma.js";

async function main() {
  const company = await prisma.company.findFirst({ where: { name: "PlanAnalytics Dev" }, select: { id: true } });
  const rows = await prisma.engineeringKnowledgeEntry.findMany({
    where: { companyId: company.id, concept: { contains: "Contract Award" } },
    select: { concept: true, status: true, discipline: true, engineeringObject: true, engineeringWork: true, deliverableType: true, lifecycleStage: true, aliases: true },
  });
  console.log(JSON.stringify(rows, null, 2));
  const rows2 = await prisma.engineeringKnowledgeEntry.findMany({
    where: { companyId: company.id, concept: { contains: "Due Diligence" } },
    select: { concept: true, status: true, discipline: true, engineeringObject: true, engineeringWork: true, deliverableType: true, lifecycleStage: true, aliases: true },
  });
  console.log(JSON.stringify(rows2, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
