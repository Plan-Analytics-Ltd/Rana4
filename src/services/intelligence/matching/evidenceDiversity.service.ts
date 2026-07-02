import type { ProgrammeState } from "@prisma/client";

export type EvidenceDiversityMetrics = {
  /** Total observations considered (may include revisions). */
  observationCount: number;
  /** Distinct deliverable identities across evidence. */
  distinctDeliverables: number;
  /** Distinct programme snapshots (revisions). */
  distinctRevisions: number;
  /** Distinct independent projects. */
  distinctProjects: number;
  /** Projects with completed (as-built) programme state. */
  completedProjects: number;
  /** Ratio revisions / projects — high means many revisions per project. */
  revisionRatio: number;
  quantityLabel: string;
  diversityLabel: string;
  maturityLabel: string;
};

function maturityFrom(completedProjects: number, distinctProjects: number): string {
  if (completedProjects >= 3 || distinctProjects >= 3) return "Strong";
  if (completedProjects >= 1 || distinctProjects >= 2) return "Moderate";
  if (distinctProjects >= 1) return "Early";
  return "Insufficient";
}

function diversityFrom(distinctProjects: number, revisionRatio: number): string {
  if (distinctProjects >= 3) return "Broad";
  if (distinctProjects >= 2) return "Growing";
  if (revisionRatio > 3) return "Single project (many revisions)";
  if (distinctProjects === 1) return "Single project";
  return "Limited";
}

export function computeEvidenceDiversity(args: {
  samples: Array<{ projectId: string; deliverableId?: string | null; deliverableName?: string; snapshotId?: string; programmeState?: ProgrammeState | null }>;
}): EvidenceDiversityMetrics {
  const projects = new Set<string>();
  const snapshots = new Set<string>();
  const deliverables = new Set<string>();
  const completedProjects = new Set<string>();
  const completedStates: ProgrammeState[] = ["AS_BUILT", "FINAL_AS_BUILT"];

  for (const s of args.samples) {
    projects.add(s.projectId);
    if (s.snapshotId) snapshots.add(s.snapshotId);
    deliverables.add(s.deliverableId ?? s.deliverableName ?? "unknown");
    if (s.programmeState && completedStates.includes(s.programmeState)) {
      completedProjects.add(s.projectId);
    }
  }

  const distinctProjects = projects.size;
  const distinctRevisions = snapshots.size || args.samples.length;
  const revisionRatio = distinctProjects > 0 ? distinctRevisions / distinctProjects : 1;

  return {
    observationCount: args.samples.length,
    distinctDeliverables: deliverables.size,
    distinctRevisions,
    distinctProjects,
    completedProjects: completedProjects.size,
    revisionRatio: Math.round(revisionRatio * 100) / 100,
    quantityLabel: `${args.samples.length} observation${args.samples.length === 1 ? "" : "s"}`,
    diversityLabel: diversityFrom(distinctProjects, revisionRatio),
    maturityLabel: maturityFrom(completedProjects.size, distinctProjects),
  };
}

/** Adjust confidence when many revisions come from few projects. */
export function revisionDiversityPenalty(revisionRatio: number, distinctProjects: number): number {
  if (distinctProjects >= 3) return 1;
  if (distinctProjects >= 2) return 0.9;
  if (revisionRatio > 4) return 0.5;
  if (revisionRatio > 2) return 0.7;
  return 0.85;
}
