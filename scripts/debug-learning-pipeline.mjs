import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const snapCount = await prisma.programmeSnapshot.count();
  const byState = await prisma.programmeSnapshot.groupBy({
    by: ["programmeState"],
    _count: true,
  });
  const byRole = await prisma.programmeSnapshot.groupBy({
    by: ["snapshotRole"],
    _count: true,
  });
  const delSnap = await prisma.deliverableSnapshot.count();
  const withDates = await prisma.deliverableSnapshot.count({
    where: {
      OR: [
        { AND: [{ plannedStart: { not: null } }, { plannedFinish: { not: null } }] },
        { AND: [{ actualStart: { not: null } }, { actualFinish: { not: null } }] },
      ],
    },
  });
  const profiles = await prisma.deliverableKnowledgeProfile.count();
  const insights = await prisma.learnedInsight.count();
  const allowedStates = ["APPROVED_BASELINE", "AS_BUILT", "FINAL_AS_BUILT"];
  const eligibleSnaps = await prisma.programmeSnapshot.count({
    where: { programmeState: { in: allowedStates } },
  });
  const sample = await prisma.programmeSnapshot.findMany({
    take: 5,
    orderBy: { importedAt: "desc" },
    include: {
      _count: { select: { deliverableSnapshots: true, activitySnapshots: true } },
    },
  });
  const sampleDel = await prisma.deliverableSnapshot.findMany({
    take: 5,
    select: {
      name: true,
      plannedStart: true,
      plannedFinish: true,
      actualStart: true,
      actualFinish: true,
    },
  });
  const actSnapWithDates = await prisma.activitySnapshot.count({
    where: {
      OR: [
        { AND: [{ startDate: { not: null } }, { finishDate: { not: null } }] },
        { AND: [{ earlyStart: { not: null } }, { earlyFinish: { not: null } }] },
      ],
    },
  });
  const actSnapTotal = await prisma.activitySnapshot.count();

  console.log(
    JSON.stringify(
      {
        snapCount,
        eligibleSnaps,
        byState,
        byRole,
        delSnap,
        withDates,
        actSnapTotal,
        actSnapWithDates,
        profiles,
        insights,
        sample,
        sampleDel,
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
