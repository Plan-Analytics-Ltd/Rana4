#!/usr/bin/env node
/**
 * Pulls every EngineeringKnowledgeEntry (the developer-reviewed "brain" table —
 * DEVELOPER_APPROVED / DEVELOPER_MODIFIED / REJECTED) across all companies, with
 * every field, PLUS real supporting context: actual live deliverables and
 * historical snapshot deliverables in the database whose name normalises to the
 * same concept subject, so precise discipline/object/work/type/lifecycle/alias
 * values can be filled in grounded in real evidence (fragnet, activities,
 * activity-code discipline, classification tags, parentWbs/wbsPath) rather than
 * guessed from the concept label alone.
 *
 * Read-only. No writes. Output: JSON to stdout (redirect to a file to review).
 */
import { prisma } from "../dist/utils/prisma.js";
import { conceptSubject } from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

function activityCodeDisciplineFromAssignments(activityCodeAssignments) {
  for (const a of activityCodeAssignments ?? []) {
    const slug = (a.type?.slug ?? "").toLowerCase();
    if (!slug.includes("discipline")) continue;
    const val = (a.code?.shortName ?? a.code?.name ?? "").trim();
    if (val) return val;
  }
  return null;
}

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });

  // Build a key -> real examples index across the whole dataset first.
  const liveByKey = new Map();
  const snapshotByKey = new Map();

  for (const company of companies) {
    const deliverables = await prisma.deliverable.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        name: true,
        classification: true,
        project: { select: { name: true } },
        fragnet: { select: { name: true } },
        activities: { select: { name: true } },
        activityCodeAssignments: {
          select: { type: { select: { slug: true } }, code: { select: { name: true, shortName: true } } },
        },
      },
    });
    for (const d of deliverables) {
      const key = conceptSubject(d.name).key;
      const list = liveByKey.get(key) ?? [];
      if (list.length < 8) {
        list.push({
          company: company.name,
          project: d.project.name,
          name: d.name,
          fragnet: d.fragnet?.name ?? null,
          classification: d.classification,
          relatedActivityNames: d.activities.map((a) => a.name).slice(0, 10),
          activityCodeDiscipline: activityCodeDisciplineFromAssignments(d.activityCodeAssignments),
        });
      }
      liveByKey.set(key, list);
    }

    const snapshots = await prisma.deliverableSnapshot.findMany({
      where: { snapshot: { companyId: company.id } },
      select: {
        name: true,
        parentWbs: true,
        wbsPath: true,
        discipline: true,
        classification: true,
        classificationTags: true,
        snapshot: { select: { project: { select: { name: true } } } },
      },
      take: 8000,
    });
    for (const s of snapshots) {
      const key = conceptSubject(s.name).key;
      const list = snapshotByKey.get(key) ?? [];
      if (list.length < 8) {
        const tags =
          s.classificationTags && typeof s.classificationTags === "object" && !Array.isArray(s.classificationTags)
            ? s.classificationTags
            : null;
        list.push({
          company: company.name,
          project: s.snapshot.project.name,
          name: s.name,
          parentWbs: s.parentWbs,
          wbsPath: s.wbsPath,
          storedDiscipline: s.discipline,
          classification: s.classification,
          classificationTags: tags,
        });
      }
      snapshotByKey.set(key, list);
    }
  }

  const results = [];
  for (const company of companies) {
    const entries = await prisma.engineeringKnowledgeEntry.findMany({
      where: { companyId: company.id },
      orderBy: { concept: "asc" },
      select: {
        id: true,
        fingerprint: true,
        status: true,
        lastAction: true,
        concept: true,
        discipline: true,
        engineeringObject: true,
        engineeringWork: true,
        deliverableType: true,
        lifecycleStage: true,
        aliases: true,
        evidence: true,
        reviewNotes: true,
        reviewedBy: true,
        projectCount: true,
        successfulComparisons: true,
        firstObservedAt: true,
        lastObservedAt: true,
      },
    });

    for (const entry of entries) {
      const keyFromConcept = conceptSubject(entry.concept).key;
      const liveExamples = liveByKey.get(keyFromConcept) ?? [];
      const snapshotExamples = snapshotByKey.get(keyFromConcept) ?? [];

      results.push({
        company: company.name,
        id: entry.id,
        concept: entry.concept,
        derivedKey: keyFromConcept,
        status: entry.status,
        lastAction: entry.lastAction,
        current: {
          discipline: entry.discipline,
          engineeringObject: entry.engineeringObject,
          engineeringWork: entry.engineeringWork,
          deliverableType: entry.deliverableType,
          lifecycleStage: entry.lifecycleStage,
          aliases: entry.aliases,
        },
        evidence: entry.evidence,
        reviewNotes: entry.reviewNotes,
        reviewedBy: entry.reviewedBy,
        projectCount: entry.projectCount,
        successfulComparisons: entry.successfulComparisons,
        realLiveExamples: liveExamples,
        realSnapshotExamples: snapshotExamples,
        missingFields: [
          !entry.discipline && "discipline",
          !entry.engineeringObject && "engineeringObject",
          !entry.engineeringWork && "engineeringWork",
          !entry.deliverableType && "deliverableType",
          !entry.lifecycleStage && "lifecycleStage",
          (!Array.isArray(entry.aliases) || entry.aliases.length === 0) && "aliases",
        ].filter(Boolean),
      });
    }
  }

  console.log(JSON.stringify({ totalEntries: results.length, entries: results }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
