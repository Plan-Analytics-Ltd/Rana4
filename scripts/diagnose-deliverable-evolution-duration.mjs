/**
 * Compare live deliverable duration vs Project Evolution snapshot history for one deliverable.
 *
 * Usage:
 *   npm run build
 *   node scripts/diagnose-deliverable-evolution-duration.mjs <projectId> <deliverableId> [companyId]
 *
 * Or find candidates with duplicate template names:
 *   node scripts/diagnose-deliverable-evolution-duration.mjs --find <projectId> [companyId]
 */
import { PrismaClient } from "@prisma/client";
import {
  buildProjectEvolutionSnapshotWhere,
  getDeliverableProjectEvolution,
  oneDeliverableSnapshotPerProgrammeRevision,
} from "../dist/services/intelligence/shared/deliverableProjectEvolution.service.js";
import { resolveDeliverableDurationView } from "../dist/services/intelligence/shared/durationSource.service.js";

const prisma = new PrismaClient();

function usage() {
  console.error(`
Usage:
  node scripts/diagnose-deliverable-evolution-duration.mjs <projectId> <deliverableId> [companyId]
  node scripts/diagnose-deliverable-evolution-duration.mjs --find <projectId> [companyId]
`);
}

async function resolveCompanyId(projectId, companyIdArg) {
  if (companyIdArg) return companyIdArg;
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { companyId: true, name: true },
  });
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return { companyId: project.companyId, projectName: project.name };
}

async function findCandidates(projectId, companyId) {
  const deliverables = await prisma.deliverable.findMany({
    where: { projectId, companyId },
    select: {
      id: true,
      name: true,
      likelyDuration: true,
      bestDuration: true,
      fragnetId: true,
      fragnet: { select: { name: true } },
    },
    orderBy: [{ name: "asc" }, { fragnet: { name: "asc" } }],
  });

  const byName = new Map();
  for (const d of deliverables) {
    const key = d.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(d);
  }

  const duplicateGroups = [...byName.entries()].filter(([, list]) => list.length > 1);
  console.log(`Project ${projectId} — ${deliverables.length} deliverables, ${duplicateGroups.length} duplicate-name groups\n`);

  if (duplicateGroups.length === 0) {
    console.log("No duplicate names. Pick any deliverable id from the list:");
    for (const d of deliverables.slice(0, 20)) {
      console.log(
        `  ${d.id}  likely=${d.likelyDuration}  name="${d.name}"  fragnet=${d.fragnet?.name ?? "—"}`
      );
    }
    return;
  }

  for (const [name, group] of duplicateGroups.slice(0, 5)) {
    console.log(`"${name}" (${group.length} deliverables):`);
    for (const d of group) {
      console.log(
        `  id=${d.id}  likely=${d.likelyDuration}  best=${d.bestDuration}  fragnet=${d.fragnet?.name ?? "null"} (${d.fragnetId ?? "null"})`
      );
    }
    console.log("");
  }

  console.log("Run full diagnosis on one id, e.g.:");
  console.log(
    `  node scripts/diagnose-deliverable-evolution-duration.mjs ${projectId} ${duplicateGroups[0][1][0].id} ${companyId}`
  );
}

async function diagnose(projectId, deliverableId, companyId) {
  const live = await prisma.deliverable.findFirst({
    where: { id: deliverableId, projectId, companyId },
    select: {
      id: true,
      name: true,
      likelyDuration: true,
      bestDuration: true,
      fragnetId: true,
      fragnet: { select: { id: true, name: true } },
      project: { select: { name: true } },
    },
  });

  if (!live) {
    throw new Error(`Deliverable not found: ${deliverableId} in project ${projectId}`);
  }

  const anchor = {
    deliverableId: live.id,
    name: live.name,
    fragnetId: live.fragnetId,
  };

  const whereStrict = {
    snapshot: { projectId, companyId },
    deliverableId: live.id,
  };

  const whereEvolution = buildProjectEvolutionSnapshotWhere({ projectId, companyId, anchor });

  const [rawStrict, rawEvolution, durationView, report] = await Promise.all([
    prisma.deliverableSnapshot.findMany({
      where: whereStrict,
      select: {
        id: true,
        deliverableId: true,
        name: true,
        fragnetId: true,
        workPackageDurationDays: true,
        snapshot: {
          select: {
            id: true,
            snapshotVersion: true,
            snapshotRole: true,
            importedAt: true,
            label: true,
          },
        },
      },
      orderBy: { snapshot: { importedAt: "asc" } },
    }),
    prisma.deliverableSnapshot.findMany({
      where: whereEvolution,
      select: {
        id: true,
        deliverableId: true,
        name: true,
        fragnetId: true,
        workPackageDurationDays: true,
        snapshot: {
          select: {
            id: true,
            snapshotVersion: true,
            snapshotRole: true,
            importedAt: true,
            label: true,
          },
        },
      },
      orderBy: { snapshot: { importedAt: "asc" } },
    }),
    resolveDeliverableDurationView({ projectId, companyId, deliverableId: live.id }),
    getDeliverableProjectEvolution({ projectId, companyId, deliverableId: live.id }),
  ]);

  const dedupedEvolution = oneDeliverableSnapshotPerProgrammeRevision(rawEvolution);

  const strictSnapIds = new Set(rawStrict.map((r) => r.snapshot.id));
  const extraFromOr = rawEvolution.filter((r) => !strictSnapIds.has(r.snapshot.id));
  const foreignDeliverableIds = [
    ...new Set(
      rawEvolution
        .map((r) => r.deliverableId)
        .filter((id) => id && id !== live.id)
    ),
  ];

  const multiMatchByProgrammeSnap = new Map();
  for (const row of rawEvolution) {
    const list = multiMatchByProgrammeSnap.get(row.snapshot.id) ?? [];
    list.push(row);
    multiMatchByProgrammeSnap.set(row.snapshot.id, list);
  }
  const collisions = [...multiMatchByProgrammeSnap.entries()].filter(([, rows]) => rows.length > 1);

  const latestStrict = rawStrict[rawStrict.length - 1] ?? null;
  const latestEvolutionRevision = report.revisions[report.revisions.length - 1] ?? null;

  console.log("=".repeat(72));
  console.log("DELIVERABLE EVOLUTION DURATION DIAGNOSIS");
  console.log("=".repeat(72));
  console.log("");
  console.log("CLICKED DELIVERABLE (live)");
  console.log(`  deliverableId     : ${live.id}`);
  console.log(`  name              : ${live.name}`);
  console.log(`  fragnetId         : ${live.fragnetId ?? "null"}`);
  console.log(`  fragnetName       : ${live.fragnet?.name ?? "null"}`);
  console.log(`  likelyDuration    : ${live.likelyDuration} days  ← Deliverables table "Likely" column`);
  console.log(`  bestDuration      : ${live.bestDuration} days`);
  console.log(`  durationView.current : ${durationView.current.durationDays} days (${durationView.current.source})`);
  console.log(`  durationView.baseline: ${durationView.baseline.durationDays ?? "null"} days`);
  console.log("");

  console.log("PROJECT EVOLUTION API (what the drawer uses)");
  console.log(`  report.deliverableId : ${report.deliverableId}`);
  console.log(`  report.deliverableName: ${report.deliverableName}`);
  console.log(`  revisionCount        : ${report.revisions.length}`);
  console.log(`  evolution.finalDuration   : ${report.evolution.finalDuration} days  ← drawer "Latest duration"`);
  console.log(`  evolution.initialDuration : ${report.evolution.initialDuration} days`);
  console.log(`  evolution.maximumDuration : ${report.evolution.maximumDuration} days`);
  console.log("");

  console.log("REVISION TIMELINE (API)");
  for (const rev of report.revisions) {
    console.log(
      `  snapshotId=${rev.snapshotId}  v?  label="${rev.label}"  durationDays=${rev.durationDays}  change=${rev.durationChangeDays ?? "—"}`
    );
  }
  console.log("");

  console.log("RAW SNAPSHOTS — deliverableId ONLY (strict identity)");
  console.log(`  rowCount=${rawStrict.length}  programmeRevisions=${new Set(rawStrict.map((r) => r.snapshot.id)).size}`);
  for (const row of rawStrict) {
    console.log(
      `  deliverableSnapshotId=${row.id}  programmeSnapshotId=${row.snapshot.id}  v${row.snapshot.snapshotVersion}  snapshotDeliverableId=${row.deliverableId ?? "null"}  workPackageDurationDays=${row.workPackageDurationDays ?? "null"}  snapName="${row.name}"  snapFragnetId=${row.fragnetId ?? "null"}`
    );
  }
  console.log("");

  console.log("RAW SNAPSHOTS — evolution WHERE (deliverableId OR fragnetId+name)");
  console.log(
    `  rowCount=${rawEvolution.length}  afterDedup=${dedupedEvolution.length}  extraVsStrict=${extraFromOr.length}  foreignDeliverableIds=${foreignDeliverableIds.length}`
  );
  for (const row of rawEvolution) {
    const via =
      row.deliverableId === live.id
        ? "deliverableId"
        : row.fragnetId === live.fragnetId
          ? "fragnetId+name"
          : "other";
    console.log(
      `  [${via}] programmeSnapshotId=${row.snapshot.id}  v${row.snapshot.snapshotVersion}  snapshotDeliverableId=${row.deliverableId ?? "null"}  workPackageDurationDays=${row.workPackageDurationDays ?? "null"}  snapName="${row.name}"  snapFragnetId=${row.fragnetId ?? "null"}`
    );
  }

  if (extraFromOr.length > 0) {
    console.log("");
    console.log("EXTRA ROWS from OR fallback (not in strict deliverableId set):");
    for (const row of extraFromOr) {
      console.log(
        `  programmeSnapshotId=${row.snapshot.id}  snapshotDeliverableId=${row.deliverableId ?? "null"}  workPackageDurationDays=${row.workPackageDurationDays ?? "null"}`
      );
    }
  }

  if (collisions.length > 0) {
    console.log("");
    console.log("PROGRAMME REVISION COLLISIONS (multiple deliverable_snapshots per programme snapshot):");
    for (const [snapId, rows] of collisions) {
      console.log(`  programmeSnapshotId=${snapId}:`);
      for (const row of rows) {
        console.log(
          `    snapshotDeliverableId=${row.deliverableId ?? "null"}  workPackageDurationDays=${row.workPackageDurationDays ?? "null"}  name="${row.name}"`
        );
      }
    }
  }

  console.log("");
  console.log("=".repeat(72));
  console.log("VERDICT");
  console.log("=".repeat(72));

  const wrongDeliverable =
    report.deliverableId !== live.id ||
    foreignDeliverableIds.length > 0 ||
    extraFromOr.length > 0 ||
    collisions.length > 0;

  const liveVsSnapshot =
    live.likelyDuration !== (latestStrict?.workPackageDurationDays ?? null) ||
    live.likelyDuration !== report.evolution.finalDuration;

  const drawerShowsSnapshotNotLive =
    report.evolution.finalDuration !== live.likelyDuration &&
    report.evolution.finalDuration === (latestEvolutionRevision?.durationDays ?? null);

  if (wrongDeliverable) {
    console.log("① WRONG DELIVERABLE / IDENTITY BLEED — investigate deliverableId OR (fragnetId+name) fallback");
    if (report.deliverableId !== live.id) {
      console.log(`   API report.deliverableId (${report.deliverableId}) !== clicked (${live.id})`);
    }
    if (foreignDeliverableIds.length > 0) {
      console.log(`   Evolution query matched foreign deliverableIds: ${foreignDeliverableIds.join(", ")}`);
    }
    if (extraFromOr.length > 0) {
      console.log(`   ${extraFromOr.length} programme revision(s) included only via fragnetId+name OR`);
    }
    if (collisions.length > 0) {
      console.log(`   ${collisions.length} programme revision(s) have multiple matching deliverable_snapshot rows`);
    }
  } else {
    console.log("① WRONG DELIVERABLE — not indicated (all snapshot deliverableIds match clicked id; no OR-only extras)");
  }

  if (drawerShowsSnapshotNotLive && !wrongDeliverable) {
    console.log("② CORRECT DELIVERABLE, DIFFERENT METRIC — drawer shows snapshot work-package duration, not live likelyDuration");
    console.log(`   likelyDuration (table)     = ${live.likelyDuration} days`);
    console.log(`   evolution.finalDuration    = ${report.evolution.finalDuration} days`);
    console.log(`   latest snapshot workPackage= ${latestStrict?.workPackageDurationDays ?? "null"} days`);
  } else if (!wrongDeliverable && live.likelyDuration === report.evolution.finalDuration) {
    console.log("② METRIC ALIGNMENT — live likelyDuration matches evolution final duration");
  }

  if (!wrongDeliverable && liveVsSnapshot) {
    console.log("③ LIVE vs SNAPSHOT HISTORY DIVERGE — same deliverable, but live likelyDuration ≠ imported snapshot durations");
    console.log(`   likelyDuration        = ${live.likelyDuration}`);
    console.log(`   latest snapshot WP    = ${latestStrict?.workPackageDurationDays ?? "null"}`);
    console.log(`   baseline snapshot WP  = ${durationView.baseline.durationDays ?? "null"}`);
    if (rawStrict.length > 1) {
      const durations = rawStrict.map((r) => r.workPackageDurationDays).join(" → ");
      console.log(`   snapshot history WP   = ${durations}`);
    }
  } else if (!wrongDeliverable && !liveVsSnapshot) {
    console.log("③ LIVE AND SNAPSHOT — aligned on latest duration");
  }

  console.log("");
}

const args = process.argv.slice(2);
if (args.length === 0) {
  usage();
  process.exit(1);
}

try {
  if (args[0] === "--find") {
    const projectId = args[1];
    if (!projectId) {
      usage();
      process.exit(1);
    }
    const resolved = await resolveCompanyId(projectId, args[2]);
    const companyId = typeof resolved === "string" ? resolved : resolved.companyId;
    await findCandidates(projectId, companyId);
  } else {
    const [projectId, deliverableId, companyIdArg] = args;
    if (!projectId || !deliverableId) {
      usage();
      process.exit(1);
    }
    const resolved = await resolveCompanyId(projectId, companyIdArg);
    const companyId = typeof resolved === "string" ? resolved : resolved.companyId;
    await diagnose(projectId, deliverableId, companyId);
  }
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
