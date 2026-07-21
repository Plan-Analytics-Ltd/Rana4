#!/usr/bin/env node
/**
 * Read-only severity audit for the "Previous Projects" duration-matching feature.
 *
 * Hypothesis (from real screenshots, not yet confirmed against live data):
 * matching is gated only on (discipline, engineeringObject, engineeringWork) —
 * fragnet and activities never filter candidates, only label which tier a match
 * came from. This can pull in historically-unrelated deliverables purely because
 * they share a generic taxonomy bucket (e.g. milestones -> "project_management",
 * drainage_design workpackage -> "drainage" object).
 *
 * This script does NOT change any matching logic. It re-uses the exact same
 * functions the product uses (getDeliverableDurationStatisticsPresentation,
 * nameSimilarity) and reports, for every project in the database:
 *   - how many deliverables get a historical match at all
 *   - of those, how many have a HIGH variance (max/min ratio) suggesting the
 *     samples aren't really comparable
 *   - of those, how many have LOW name similarity to at least one of their
 *     contributing matches (using the existing, currently-unused
 *     LOW_NAME_CONSISTENCY_THRESHOLD = 0.3 already defined in the codebase)
 *
 * Run: node scripts/audit-duration-match-quality.mjs
 */
import { prisma } from "../dist/utils/prisma.js";
import {
  getDeliverableDurationStatisticsPresentation,
  nameSimilarity,
  LOW_NAME_CONSISTENCY_THRESHOLD,
} from "../dist/services/deliverableDurationStatisticsPresentation.service.js";

const HIGH_VARIANCE_RATIO = 3; // max/min >= 3x flagged as suspicious

async function main() {
  // The prisma client enforces tenant scoping via an extension that requires either
  // request-scoped auth context (not present in a standalone script) or an explicit
  // companyId in the query's `where`. `company` itself isn't tenant-scoped, so list
  // companies first, then query projects per-company with an explicit companyId.
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });

  const projects = [];
  for (const company of companies) {
    const companyProjects = await prisma.project.findMany({
      where: { companyId: company.id },
      select: { id: true, name: true, companyId: true },
      orderBy: { name: "asc" },
    });
    projects.push(...companyProjects);
  }

  console.log(`Auditing ${projects.length} project(s) across ${companies.length} compan${companies.length === 1 ? "y" : "ies"}...\n`);

  let totalDeliverables = 0;
  let totalMatched = 0;
  let highVarianceCount = 0;
  let lowNameSimilarityCount = 0;
  const worstOffenders = [];

  for (const project of projects) {
    let result;
    try {
      result = await getDeliverableDurationStatisticsPresentation({
        companyId: project.companyId,
        projectId: project.id,
      });
    } catch (err) {
      console.log(`  [skip] ${project.name}: ${err.message}`);
      continue;
    }

    for (const item of result.items) {
      totalDeliverables += 1;
      if (!item.statistics.available) continue;
      totalMatched += 1;

      const { minimumDays, maximumDays, averageDays } = item.statistics;
      const ratio = minimumDays > 0 ? maximumDays / minimumDays : Infinity;
      const isHighVariance = item.contributingProjects.length > 1 && ratio >= HIGH_VARIANCE_RATIO;

      const nameSims = item.contributingProjects.map((p) => ({
        matchedName: p.matchedDeliverableName,
        projectName: p.projectName,
        sim: nameSimilarity(item.name, p.matchedDeliverableName),
        days: p.planningDurationDays,
      }));
      const worstNameSim = Math.min(...nameSims.map((n) => n.sim));
      const isLowNameSimilarity = worstNameSim < LOW_NAME_CONSISTENCY_THRESHOLD;

      if (isHighVariance) highVarianceCount += 1;
      if (isLowNameSimilarity) lowNameSimilarityCount += 1;

      if (isHighVariance || isLowNameSimilarity) {
        worstOffenders.push({
          project: project.name,
          deliverable: item.name,
          comparisonBasis: item.comparisonBasis,
          minimumDays,
          averageDays,
          maximumDays,
          ratio: Number.isFinite(ratio) ? ratio.toFixed(1) : "inf",
          worstNameSim: worstNameSim.toFixed(2),
          contributingProjects: nameSims,
        });
      }
    }
  }

  worstOffenders.sort((a, b) => {
    const ra = Number.isFinite(Number(a.ratio)) ? Number(a.ratio) : 999;
    const rb = Number.isFinite(Number(b.ratio)) ? Number(b.ratio) : 999;
    return rb - ra;
  });

  console.log("=== SUMMARY ===");
  console.log(`Total deliverables checked: ${totalDeliverables}`);
  console.log(`Deliverables with a historical match: ${totalMatched}`);
  console.log(
    `  High variance (max/min >= ${HIGH_VARIANCE_RATIO}x, 2+ samples): ${highVarianceCount} (${totalMatched ? ((highVarianceCount / totalMatched) * 100).toFixed(1) : 0}% of matched)`
  );
  console.log(
    `  Low name similarity (< ${LOW_NAME_CONSISTENCY_THRESHOLD} to at least one contributing match): ${lowNameSimilarityCount} (${totalMatched ? ((lowNameSimilarityCount / totalMatched) * 100).toFixed(1) : 0}% of matched)`
  );

  console.log(`\n=== TOP 20 WORST OFFENDERS (by variance ratio) ===`);
  for (const offender of worstOffenders.slice(0, 20)) {
    console.log(
      `\n[${offender.project}] "${offender.deliverable}" — basis=${offender.comparisonBasis}, min=${offender.minimumDays} avg=${offender.averageDays} max=${offender.maximumDays} (ratio ${offender.ratio}x), worst name similarity ${offender.worstNameSim}`
    );
    for (const p of offender.contributingProjects) {
      console.log(`    <- "${p.matchedName}" (${p.projectName}), ${p.days}d, nameSim=${p.sim.toFixed(2)}`);
    }
  }

  console.log(`\nTotal flagged (high variance OR low name similarity): ${worstOffenders.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
