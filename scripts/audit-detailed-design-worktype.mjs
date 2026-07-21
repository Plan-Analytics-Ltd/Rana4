#!/usr/bin/env node
/**
 * Scope check for a real taxonomy bug found via user inspection: the engineeringWork
 * rule `/\bdetail(?:ing|ed)?\b/i` -> "detailing" matches "Detailed Design" (a standard
 * industry stage name, where "detailed" describes design maturity) the same as
 * "Reinforcement Detailing" (a genuinely different type of work — shop-drawing/rebar
 * schedule production). This checks how many real deliverables are actually affected,
 * across both live deliverables and historical snapshots, using the same identity
 * construction the duration-matching feature actually uses for each.
 *
 * Also checks activityCodeAssignments-derived discipline (a different signal than what
 * duration-matching's live-target resolution currently uses) to explain a reported
 * discrepancy: a live "Detailed Design" deliverable was seen showing discipline "Civil"
 * somewhere in the app, but duration-matching's own resolution doesn't have access to
 * that signal for live targets today.
 *
 * Read-only. No writes.
 */
import { prisma } from "../dist/utils/prisma.js";
import { resolveEngineeringIdentity } from "../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";

const DETAIL_NOT_DETAILING = /\bdetail(?:ed)?\b/i;
const DETAILING_WORD = /\bdetailing\b/i;

function isAmbiguousDetailName(name) {
  return DETAIL_NOT_DETAILING.test(name) && !DETAILING_WORD.test(name);
}

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

  let liveTotal = 0;
  let liveAmbiguous = 0;
  let liveDetailingMisclassified = 0;
  const liveExamples = [];

  let snapshotTotal = 0;
  let snapshotAmbiguous = 0;
  let snapshotDetailingMisclassified = 0;
  const snapshotExamples = [];

  for (const company of companies) {
    const projects = await prisma.project.findMany({
      where: { companyId: company.id },
      select: { id: true, name: true },
    });

    for (const project of projects) {
      const deliverables = await prisma.deliverable.findMany({
        where: { companyId: company.id, projectId: project.id },
        select: {
          id: true,
          name: true,
          classification: true,
          fragnet: { select: { name: true } },
          activities: { select: { name: true } },
          activityCodeAssignments: {
            select: { type: { select: { slug: true } }, code: { select: { name: true, shortName: true } } },
          },
        },
      });

      for (const d of deliverables) {
        liveTotal += 1;
        if (!isAmbiguousDetailName(d.name)) continue;
        liveAmbiguous += 1;

        // Same construction duration-matching uses for LIVE targets today: name,
        // fragnet, classification, related activity names only — no discipline metadata.
        const identity = enforceEngineeringIdentityValidation(
          resolveEngineeringIdentity({
            deliverableName: d.name,
            fragnetName: d.fragnet?.name ?? null,
            classification: d.classification,
            relatedActivityNames: d.activities.map((a) => a.name),
          })
        );
        const misclassified = identity.engineeringWork.id === "detailing";
        if (misclassified) liveDetailingMisclassified += 1;

        const activityCodeDiscipline = activityCodeDisciplineFromAssignments(d.activityCodeAssignments);

        if (liveExamples.length < 25) {
          liveExamples.push({
            company: company.name,
            project: project.name,
            name: d.name,
            fragnet: d.fragnet?.name ?? null,
            resolvedWork: identity.engineeringWork.id,
            resolvedDiscipline: identity.discipline.id,
            activityCodeDiscipline,
          });
        }
      }
    }

    const snapshots = await prisma.deliverableSnapshot.findMany({
      where: { snapshot: { companyId: company.id } },
      select: {
        name: true,
        parentWbs: true,
        wbsPath: true,
        discipline: true,
        classificationTags: true,
        classification: true,
        snapshot: { select: { project: { select: { name: true } } } },
      },
      take: 5000,
    });

    for (const s of snapshots) {
      snapshotTotal += 1;
      if (!isAmbiguousDetailName(s.name)) continue;
      snapshotAmbiguous += 1;

      const tags =
        s.classificationTags && typeof s.classificationTags === "object" && !Array.isArray(s.classificationTags)
          ? s.classificationTags
          : null;

      const identity = enforceEngineeringIdentityValidation(
        resolveEngineeringIdentity({
          deliverableName: s.name,
          parentWbs: s.parentWbs,
          wbsPath: s.wbsPath,
          disciplineTag: s.discipline,
          classificationTags: tags,
          classification: s.classification,
        })
      );
      const misclassified = identity.engineeringWork.id === "detailing";
      if (misclassified) snapshotDetailingMisclassified += 1;

      if (snapshotExamples.length < 25) {
        snapshotExamples.push({
          company: company.name,
          project: s.snapshot.project.name,
          name: s.name,
          storedDiscipline: s.discipline,
          resolvedWork: identity.engineeringWork.id,
          resolvedDiscipline: identity.discipline.id,
        });
      }
    }
  }

  console.log("=== LIVE DELIVERABLES ===");
  console.log(`Total: ${liveTotal}`);
  console.log(`Ambiguous "detail(ed)" name (not "detailing"): ${liveAmbiguous}`);
  console.log(`  -> resolved engineeringWork="detailing" (likely misclassified): ${liveDetailingMisclassified}`);
  console.log("\nSample (up to 25):");
  for (const ex of liveExamples) {
    console.log(
      `  [${ex.company} / ${ex.project}] "${ex.name}" (fragnet=${ex.fragnet}) -> work=${ex.resolvedWork} discipline=${ex.resolvedDiscipline} | activityCodeAssignment discipline=${ex.activityCodeDiscipline}`
    );
  }

  console.log("\n=== HISTORICAL SNAPSHOT DELIVERABLES ===");
  console.log(`Total: ${snapshotTotal}`);
  console.log(`Ambiguous "detail(ed)" name (not "detailing"): ${snapshotAmbiguous}`);
  console.log(`  -> resolved engineeringWork="detailing" (likely misclassified): ${snapshotDetailingMisclassified}`);
  console.log("\nSample (up to 25):");
  for (const ex of snapshotExamples) {
    console.log(
      `  [${ex.company} / ${ex.project}] "${ex.name}" storedDiscipline=${ex.storedDiscipline} -> work=${ex.resolvedWork} discipline=${ex.resolvedDiscipline}`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
