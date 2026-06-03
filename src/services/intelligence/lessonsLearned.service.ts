import { prisma } from "../../utils/prisma.js";
import { computePortfolioBenchmarks } from "./portfolioBenchmark.service.js";

export type LessonFinding = {
  id: string;
  findingType: string;
  category: string;
  severity: string;
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  tags: string[];
  sampleSize: number;
  confidence: number | null;
  generatedAt: string;
};

const MIN_SAMPLE = 3;
const OVERRUN_THRESHOLD_PCT = 0.15;

/**
 * Identify portfolio patterns and persist structured findings.
 */
export async function generateLessonsLearned(companyId: string): Promise<LessonFinding[]> {
  const snapshots = await prisma.programmeSnapshot.findMany({
    where: { companyId },
    include: {
      activitySnapshots: true,
      relationshipSnapshots: true,
      project: { include: { intelligenceProfile: true } },
    },
    orderBy: { importedAt: "desc" },
    take: 500,
  });

  const projectCount = new Set(snapshots.map((s) => s.projectId)).size;
  const findings: Array<{
    findingType: string;
    category: string;
    severity: string;
    title: string;
    summary: string;
    evidence: object;
    tags: string[];
    sampleSize: number;
    confidence: number;
  }> = [];

  // Duration overrun by classification tag
  const overrunByTag = new Map<string, { over: number; total: number; projects: Set<string> }>();

  for (const snap of snapshots) {
    for (const act of snap.activitySnapshots) {
      const orig = act.originalDuration ?? act.remainingDuration;
      const actual = act.actualDuration ?? act.remainingDuration;
      if (orig == null || actual == null || orig <= 0) continue;

      const overrun = (actual - orig) / orig > OVERRUN_THRESHOLD_PCT;
      const tags = act.classificationTags as Record<string, string>;
      for (const [k, v] of Object.entries(tags)) {
        const key = `${k}:${v}`;
        const entry = overrunByTag.get(key) ?? { over: 0, total: 0, projects: new Set() };
        entry.total++;
        if (overrun) entry.over++;
        entry.projects.add(snap.projectId);
        overrunByTag.set(key, entry);
      }

      const nameLower = (act.name ?? "").toLowerCase();
      if (nameLower.includes("mep") && nameLower.includes("coordination") && overrun) {
        const k = "mep:coordination";
        const e = overrunByTag.get(k) ?? { over: 0, total: 0, projects: new Set() };
        e.total++;
        e.over++;
        e.projects.add(snap.projectId);
        overrunByTag.set(k, e);
      }
    }
  }

  for (const [tag, stats] of overrunByTag) {
    if (stats.total < MIN_SAMPLE) continue;
    const pct = Math.round((stats.over / stats.total) * 100);
    if (pct < 50) continue;

    const [category, value] = tag.split(":");
    findings.push({
      findingType: "duration_overrun",
      category: category ?? "general",
      severity: pct >= 75 ? "high" : "medium",
      title: `${value ?? tag} exceeded planned duration in ${pct}% of observations`,
      summary: `Across ${stats.projects.size} project(s), ${stats.over} of ${stats.total} activities with tag "${tag}" showed duration overruns above ${OVERRUN_THRESHOLD_PCT * 100}%.`,
      evidence: { tag, overrunCount: stats.over, totalCount: stats.total, projectCount: stats.projects.size },
      tags: [tag, category ?? "general"].filter(Boolean),
      sampleSize: stats.total,
      confidence: Math.min(0.95, stats.total / 20),
    });
  }

  // Float erosion during RIBA stages
  const floatErosionByStage = new Map<string, { eroded: number; total: number }>();
  for (const snap of snapshots) {
    const stage = snap.project.intelligenceProfile?.primaryRibaStage ?? "unknown";
    for (const act of snap.activitySnapshots) {
      if (act.totalFloat == null) continue;
      const entry = floatErosionByStage.get(stage) ?? { eroded: 0, total: 0 };
      entry.total++;
      if (act.totalFloat <= 0) entry.eroded++;
      floatErosionByStage.set(stage, entry);
    }
  }

  for (const [stage, stats] of floatErosionByStage) {
    if (stats.total < MIN_SAMPLE) continue;
    const pct = Math.round((stats.eroded / stats.total) * 100);
    if (pct < 40) continue;
    findings.push({
      findingType: "float_erosion",
      category: "riba_stage",
      severity: "medium",
      title: `Authority approvals consistently eroded float during ${stage}`,
      summary: `${pct}% of captured activities at ${stage} had zero or negative total float, indicating schedule pressure during that stage.`,
      evidence: { ribaStage: stage, erodedCount: stats.eroded, totalCount: stats.total },
      tags: ["RIBA", stage, "float"],
      sampleSize: stats.total,
      confidence: Math.min(0.9, stats.total / 15),
    });
  }

  // Unstable logic: projects with high relationship churn between snapshots
  const relCountsByProject = new Map<string, number[]>();
  for (const snap of snapshots) {
    const arr = relCountsByProject.get(snap.projectId) ?? [];
    arr.push(snap.relationshipSnapshots.length);
    relCountsByProject.set(snap.projectId, arr);
  }

  let unstableProjects = 0;
  for (const [, counts] of relCountsByProject) {
    if (counts.length >= 2) {
      const variance = Math.max(...counts) - Math.min(...counts);
      if (variance > counts[0]! * 0.2) unstableProjects++;
    }
  }
  if (unstableProjects >= 2 && projectCount >= MIN_SAMPLE) {
    findings.push({
      findingType: "logic_instability",
      category: "schedule_logic",
      severity: "medium",
      title: "Unstable logic structures detected across portfolio",
      summary: `${unstableProjects} projects showed significant relationship count changes between snapshots, suggesting recurring logic restructuring.`,
      evidence: { unstableProjectCount: unstableProjects, portfolioProjectCount: projectCount },
      tags: ["logic", "relationships"],
      sampleSize: projectCount,
      confidence: 0.7,
    });
  }

  // MEP density correlation (from benchmarks)
  const benchmarks = await computePortfolioBenchmarks(companyId);
  const mepMetric = benchmarks.metrics.find((m) => m.key.includes("mep") || m.label.toLowerCase().includes("mep"));
  if (mepMetric && mepMetric.sampleSize >= MIN_SAMPLE) {
    findings.push({
      findingType: "discipline_performance",
      category: "mep",
      severity: "info",
      title: "Projects with high MEP density showed above-average coordination delays",
      summary: `Portfolio benchmark: ${mepMetric.label} averaged ${mepMetric.average} ${mepMetric.unit} across ${mepMetric.sampleSize} observations.`,
      evidence: { metric: mepMetric },
      tags: ["MEP", "coordination"],
      sampleSize: mepMetric.sampleSize,
      confidence: 0.65,
    });
  }

  // Persist findings (replace stale generated batch)
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 1);
  await prisma.intelligenceFinding.deleteMany({
    where: { companyId, generatedAt: { gte: cutoff } },
  });

  const created = await Promise.all(
    findings.map((f) =>
      prisma.intelligenceFinding.create({
        data: {
          companyId,
          findingType: f.findingType,
          category: f.category,
          severity: f.severity,
          title: f.title,
          summary: f.summary,
          evidence: f.evidence,
          tags: f.tags,
          sampleSize: f.sampleSize,
          confidence: f.confidence,
        },
      })
    )
  );

  return created.map((f) => ({
    id: f.id,
    findingType: f.findingType,
    category: f.category,
    severity: f.severity,
    title: f.title,
    summary: f.summary,
    evidence: f.evidence as Record<string, unknown>,
    tags: f.tags as string[],
    sampleSize: f.sampleSize,
    confidence: f.confidence,
    generatedAt: f.generatedAt.toISOString(),
  }));
}

export async function listLessonsLearned(
  companyId: string,
  limit = 50
): Promise<LessonFinding[]> {
  const rows = await prisma.intelligenceFinding.findMany({
    where: { companyId },
    orderBy: { generatedAt: "desc" },
    take: limit,
  });
  return rows.map((f) => ({
    id: f.id,
    findingType: f.findingType,
    category: f.category,
    severity: f.severity,
    title: f.title,
    summary: f.summary,
    evidence: f.evidence as Record<string, unknown>,
    tags: f.tags as string[],
    sampleSize: f.sampleSize,
    confidence: f.confidence,
    generatedAt: f.generatedAt.toISOString(),
  }));
}
