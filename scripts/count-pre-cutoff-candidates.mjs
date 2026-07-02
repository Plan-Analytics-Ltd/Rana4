import { getDeliverableBenchmark } from "../dist/services/intelligence/benchmark/benchmark.service.js";

const projectId = "cmr1ztdj50001sybs8jbn4qf4";
const companyId = "cmo8dvlc10000syx0861h1zr5";

const cases = [
  { label: "10d Reinforcement", id: "c9ac0980-867b-4c48-b0ed-8a9bac5b4c18" },
  { label: "20d Reinforcement", id: "5d4d739d-677e-4400-b4a4-295d9876013a" },
  { label: "1d Milestone (first)", id: null, nameMatch: "milestone" },
  { label: "30d Ground Investigation", id: null, nameMatch: "additional ground investigation" },
  { label: "10d Model/Drawing", id: null, nameMatch: "model/drawing development" },
];

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

try {
  for (const c of cases) {
    let deliverableId = c.id;
    if (!deliverableId && c.nameMatch) {
      const d = await prisma.deliverable.findFirst({
        where: { projectId, name: { contains: c.nameMatch, mode: "insensitive" }, likelyDuration: { not: null } },
        select: { id: true, name: true, likelyDuration: true },
        orderBy: { likelyDuration: "asc" },
      });
      if (!d) continue;
      deliverableId = d.id;
      c.label = `${c.label} — ${d.name} (${d.likelyDuration}d)`;
    }

    const r = await getDeliverableBenchmark({ projectId, companyId, deliverableId });
    const ex = r.evidence?.excludedEvidence ?? {};
    const ranked = r.evidence?.allRankedCount ?? 0;
    const selected = r.evidence?.selectedCount ?? 0;
    const retained = r.benchmark.sampleSize ?? 0;

    console.log(`\n${c.label}`);
    console.log(`  After similarity scoring (ranked):     ${ranked}`);
    console.log(`  With valid duration dates:             ${ranked - (ex.missingDates ?? 0)} (approx; missingDates=${ex.missingDates})`);
    console.log(`  Before 70% cutoff (ranked w/ duration): ${ranked}`);
    console.log(`  Excluded — classification mismatch:    ${ex.classificationMismatch ?? 0}`);
    console.log(`  Excluded — below 70% similarity:       ${ex.lowDeliverableSimilarity ?? 0}`);
    console.log(`  Passed 70% cutoff (selected):          ${selected}`);
    console.log(`  After revision dedup (benchmark n):    ${retained}`);
  }
} finally {
  await prisma.$disconnect();
}
