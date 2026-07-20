/**
 * Validate Project Intelligence against a named project (default: Northvale).
 * Usage: npx tsx scripts/validate-project-intelligence.ts [projectNameSubstring]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { getProjectIntelligence } from "../src/services/intelligence/project/projectIntelligence.service.js";

const prisma = new PrismaClient();
const needle = (process.argv[2] ?? "Northvale").trim();

async function main() {
  const projects = await prisma.project.findMany({
    where: { name: { contains: needle, mode: "insensitive" }, archivedAt: null },
    select: { id: true, name: true, companyId: true },
    take: 5,
  });
  if (projects.length === 0) {
    console.error(`No project matching "${needle}"`);
    process.exit(1);
  }
  const project = projects[0]!;
  console.log(`Project: ${project.name} (${project.id})`);

  const pi = await getProjectIntelligence({
    projectId: project.id,
    companyId: project.companyId,
  });

  const e = pi.executiveSummary;
  console.log("\n=== Executive Summary ===");
  console.log({
    projectType: e.projectType,
    projectCategory: e.projectCategory,
    sector: e.sector,
    currentRevision: e.currentRevision,
    revisionCount: e.revisionCount,
    totalDeliverables: e.totalDeliverables,
    totalDisciplines: e.totalDisciplines,
    workPackagesAnalysed: e.workPackagesAnalysed,
    comparableCompletedProjects: e.comparableCompletedProjects,
    overallConfidence: e.overallConfidence,
  });

  console.log("\n=== Planning Quality ===");
  console.log(pi.planningQuality);

  console.log("\n=== Evolution Summary ===");
  console.log(pi.projectEvolutionSummary);

  console.log("\n=== Disciplines ===");
  console.log(
    pi.disciplineOverview.map((d) => ({
      discipline: d.disciplineLabel,
      wps: d.workPackageCount,
      review: d.needsReviewCount,
      confidence: d.planningConfidence,
    }))
  );

  console.log("\n=== Historical Context ===");
  console.log({
    summary: pi.historicalContext.summary,
    peers: pi.historicalContext.similarProjects.map((p) => p.projectName),
    completedProjectsUsed: pi.historicalContext.completedProjectsUsed,
  });

  console.log("\n=== Planner Priorities ===");
  for (const p of pi.plannerPriorities) {
    console.log(`P${p.priority}: ${p.deliverableName} — ${p.reason}`);
  }

  console.log("\n=== Overall Assessment ===");
  console.log(pi.overallAssessment);

  console.log("\n=== Programme Health (top findings) ===");
  for (const f of pi.programmeHealth.findings.slice(0, 8)) {
    console.log(`- [${f.kind}] ${f.statement}`);
  }

  const checks = [
    ["has deliverables", e.totalDeliverables > 0],
    ["has disciplines", e.totalDisciplines > 0],
    ["has assessment", Boolean(pi.overallAssessment)],
    ["planning quality note", Boolean(pi.planningQuality.alignmentNote)],
    ["evolution summary", Boolean(pi.projectEvolutionSummary.summary)],
  ] as const;
  console.log("\n=== Checks ===");
  for (const [label, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
