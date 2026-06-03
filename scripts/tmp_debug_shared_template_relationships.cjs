const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const fragnets = await prisma.fragnet.findMany({
      select: { id: true, name: true, projectId: true, companyId: true },
      orderBy: { createdAt: "asc" },
    });

    const out = [];

    for (const f of fragnets) {
      const sharedTemplates = await prisma.fragnetActivityTemplate.findMany({
        where: { fragnetId: f.id, companyId: f.companyId, isSharedAcrossDeliverables: true },
        select: { id: true, templateCode: true, name: true },
      });
      if (sharedTemplates.length === 0) continue;

      const templateRels = await prisma.fragnetTemplateRelationship.findMany({
        where: { fragnetId: f.id, companyId: f.companyId },
        select: { predecessorTemplateId: true, successorTemplateId: true, relationshipType: true, lag: true },
      });

      const activities = await prisma.activity.findMany({
        where: { fragnetId: f.id, companyId: f.companyId, templateActivityId: { not: null } },
        select: { id: true, templateActivityId: true, isSharedAcrossDeliverables: true },
      });
      const actByTemplate = new Map(
        activities
          .filter((a) => a.templateActivityId)
          .map((a) => [a.templateActivityId, { id: a.id, shared: a.isSharedAcrossDeliverables }])
      );

      let expectedPairs = 0;
      let missingPairs = 0;

      for (const tr of templateRels) {
        const pred = actByTemplate.get(tr.predecessorTemplateId);
        const succ = actByTemplate.get(tr.successorTemplateId);
        if (!pred || !succ) continue;
        if (!pred.shared || !succ.shared) continue;
        expectedPairs++;
        const rel = await prisma.relationship.findFirst({
          where: {
            companyId: f.companyId,
            fragnetId: f.id,
            predecessorActivityId: pred.id,
            successorActivityId: succ.id,
            relationshipType: tr.relationshipType,
          },
          select: { id: true, lag: true },
        });
        if (!rel) missingPairs++;
      }

      out.push({
        fragnetId: f.id,
        fragnetName: f.name,
        sharedTemplateCount: sharedTemplates.length,
        templateRelationshipCount: templateRels.length,
        sharedActivityCount: activities.filter((a) => a.isSharedAcrossDeliverables).length,
        expectedSharedPairsFromTemplates: expectedPairs,
        missingSharedPairs: missingPairs,
      });
    }

    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

