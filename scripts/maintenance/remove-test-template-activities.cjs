/**
 * Remove IC-test, IA-test, IC-share templates and all materialized activities.
 * Run: node scripts/remove-test-template-activities.cjs
 */
const { PrismaClient } = require("@prisma/client");

const TARGET_NAMES = ["IC-test", "IA-test", "IC-share"];

async function main() {
  const prisma = new PrismaClient();
  try {
    const templates = await prisma.fragnetActivityTemplate.findMany({
      where: { name: { in: TARGET_NAMES } },
      select: { id: true, name: true, fragnetId: true, fragnet: { select: { name: true, project: { select: { name: true } } } } },
    });

    if (templates.length === 0) {
      console.log("No matching templates found.");
      return;
    }

    const templateIds = templates.map((t) => t.id);
    console.log("Templates to remove:", templates.map((t) => `${t.fragnet.project.name}/${t.fragnet.name}: ${t.name} (${t.id})`).join("\n  "));

    const activities = await prisma.activity.findMany({
      where: {
        OR: [{ templateActivityId: { in: templateIds } }, { name: { in: TARGET_NAMES } }],
      },
      select: { id: true, activityCode: true, name: true },
    });
    console.log(`\nDeleting ${activities.length} activity row(s)...`);

    if (activities.length > 0) {
      const delActs = await prisma.activity.deleteMany({
        where: { id: { in: activities.map((a) => a.id) } },
      });
      console.log(`  activities deleted: ${delActs.count}`);
    }

    const delTplRels = await prisma.fragnetTemplateRelationship.deleteMany({
      where: {
        OR: [
          { predecessorTemplateId: { in: templateIds } },
          { successorTemplateId: { in: templateIds } },
        ],
      },
    });
    console.log(`  template relationships deleted: ${delTplRels.count}`);

    const delAssignments = await prisma.activityCodeAssignment.deleteMany({
      where: { templateActivityId: { in: templateIds } },
    });
    console.log(`  template code assignments deleted: ${delAssignments.count}`);

    const delTemplates = await prisma.fragnetActivityTemplate.deleteMany({
      where: { id: { in: templateIds } },
    });
    console.log(`  templates deleted: ${delTemplates.count}`);

    const remaining = await prisma.activity.count({
      where: { name: { in: TARGET_NAMES } },
    });
    const remainingTpl = await prisma.fragnetActivityTemplate.count({
      where: { name: { in: TARGET_NAMES } },
    });
    console.log(`\nRemaining activities named ${TARGET_NAMES.join("/")}: ${remaining}`);
    console.log(`Remaining templates named ${TARGET_NAMES.join("/")}: ${remainingTpl}`);
    console.log("Done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
