import { prisma } from "../utils/prisma.js";
import { validateActivityAssignments } from "./activityAssignmentValidation.service.js";

type RebuildOptions = {
  dryRun?: boolean;
  /** Print per-deliverable activity counts. */
  debug?: boolean;
};

type DeliverableRow = {
  id: string;
  name: string;
  fragnetId: string | null;
  projectId: string;
  companyId: string;
};

type ActivityRow = {
  id: string;
  fragnetId: string;
  deliverableId: string;
  activityCode: string;
  name: string;
  bestDuration: number;
  likelyDuration: number;
  assuranceNoteId: string | null;
  assignedResources: unknown;
  projectId: string;
  companyId: string;
};

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): Set<string> {
  const t = norm(s).split(" ").filter(Boolean);
  return new Set(t);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function isGenericActivityName(name: string): boolean {
  const n = norm(name);
  const patterns = [
    "internal check",
    "check",
    "review",
    "approval",
    "approve",
    "sign off",
    "handover",
    "qa",
    "qc",
    "coordination",
    "meeting",
    "mobilization",
    "mobilisation",
  ];
  return patterns.some((p) => n === p || n.includes(p));
}

async function getOrCreateUnassignedDeliverable(projectId: string): Promise<DeliverableRow> {
  const existing = await prisma.deliverable.findFirst({
    where: { projectId, fragnetId: null, name: "Unassigned Deliverable" },
  });
  if (existing) return existing as any;
  const created = await prisma.deliverable.create({
    data: {
      name: "Unassigned Deliverable",
      bestDuration: 1,
      likelyDuration: 1,
      fragnetId: null,
      assignedResources: [],
      projectId,
      externalProjectId: null,
    } as any,
  });
  return created as any;
}

/**
 * Deterministically rebuild activity→deliverable assignments for a standard.
 *
 * IMPORTANT:
 * - `Activity.deliverableId` is required in schema; invalid activities are reassigned to a deterministic fallback
 *   deliverable ("Unassigned Deliverable") instead of setting null.
 * - Never shares one activity row across multiple deliverables; "generic" activities may be cloned per deliverable
 *   only when safe (no relationships reference them).
 */
export async function rebuildActivityAssignmentsForStandard(
  standardId: string,
  opts: RebuildOptions = {}
): Promise<{ updated: number; created: number; standardId: string }> {
  const sid = String(standardId ?? "").trim();
  if (!sid) throw new Error("rebuildActivityAssignmentsForStandard: standardId is required");

  const standard = await prisma.standard.findUnique({
    where: { id: sid },
    include: {
      fragnets: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          deliverables: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          activities: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          relationships: true,
        },
      },
    },
  });
  if (!standard) throw new Error("rebuildActivityAssignmentsForStandard: Standard not found");

  const projectId = standard.projectId;
  const unassignedDeliverable = await getOrCreateUnassignedDeliverable(projectId);

  const deliverableById = new Map<string, DeliverableRow>();
  const deliverablesByFragnet = new Map<string, DeliverableRow[]>();
  for (const f of standard.fragnets) {
    const ds = f.deliverables as any as DeliverableRow[];
    deliverablesByFragnet.set(f.id, ds);
    for (const d of ds) deliverableById.set(d.id, d);
  }

  const activityRelationshipRefCount = new Map<string, number>();
  for (const f of standard.fragnets) {
    for (const r of f.relationships) {
      activityRelationshipRefCount.set(
        r.predecessorActivityId,
        (activityRelationshipRefCount.get(r.predecessorActivityId) ?? 0) + 1
      );
      activityRelationshipRefCount.set(
        r.successorActivityId,
        (activityRelationshipRefCount.get(r.successorActivityId) ?? 0) + 1
      );
    }
  }

  let updated = 0;
  let created = 0;

  // Phase 1: detect obviously invalid assignments and move to fallback deliverable.
  const activitiesAll = standard.fragnets.flatMap((f) => f.activities as any as ActivityRow[]);
  for (const a of activitiesAll) {
    const d = deliverableById.get(a.deliverableId);
    const deliverableFragnetId = d?.fragnetId ?? null;
    const invalid =
      !d ||
      deliverableFragnetId === null ||
      String(deliverableFragnetId) !== String(a.fragnetId);

    if (invalid) {
      if (opts.debug) {
        console.log(
          `[rebuild] INVALID assignment: activity ${a.id} "${a.name}" fragnet ${a.fragnetId} deliverable ${a.deliverableId} (deliverable.fragnetId=${deliverableFragnetId}) → Unassigned Deliverable`
        );
      }
      if (!opts.dryRun) {
        await prisma.activity.update({
          where: { id: a.id },
          data: { deliverableId: unassignedDeliverable.id },
        });
      }
      updated += 1;
    }
  }

  // Reload activities after possible updates.
  const refreshed = await prisma.standard.findUnique({
    where: { id: sid },
    include: {
      fragnets: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { deliverables: true, activities: true, relationships: true },
      },
    },
  });
  if (!refreshed) throw new Error("rebuildActivityAssignmentsForStandard: Standard not found (reload)");

  // Phase 2: per fragnet, (a) clone generic singletons per deliverable when safe, (b) reassign by strong name match.
  for (const f of refreshed.fragnets as any as Array<{
    id: string;
    deliverables: DeliverableRow[];
    activities: ActivityRow[];
    relationships: any[];
  }>) {
    const deliverables = (deliverablesByFragnet.get(f.id) ?? []).filter((d) => d.fragnetId === f.id);
    const deliverableTokenMap = new Map<string, Set<string>>();
    for (const d of deliverables) deliverableTokenMap.set(d.id, tokens(d.name));

    // Build name → activities list
    const byName = new Map<string, ActivityRow[]>();
    for (const a of f.activities) {
      const key = norm(a.name);
      byName.set(key, [...(byName.get(key) ?? []), a]);
    }

    // (a) Clone generic singletons: if a generic activity exists only once in this fragnet and is unreferenced, copy to all deliverables.
    for (const [nameKey, acts] of byName.entries()) {
      if (acts.length !== 1) continue;
      const a0 = acts[0]!;
      if (!isGenericActivityName(a0.name)) continue;
      if (deliverables.length <= 1) continue;
      if ((activityRelationshipRefCount.get(a0.id) ?? 0) > 0) continue; // unsafe to clone

      if (opts.debug) {
        console.log(`[rebuild] Cloning generic activity "${a0.name}" (${a0.id}) to ${deliverables.length} deliverables in fragnet ${f.id}`);
      }

      // Create one copy per deliverable; delete original.
      for (const d of deliverables) {
        if (!opts.dryRun) {
          await prisma.activity.create({
            data: {
              fragnetId: a0.fragnetId,
              deliverableId: d.id,
              activityCode: `${a0.activityCode}-${d.id.slice(0, 4)}`.slice(0, 100),
              name: a0.name,
              status: (a0 as any).status,
              bestDuration: a0.bestDuration,
              likelyDuration: a0.likelyDuration,
              assuranceNoteId: a0.assuranceNoteId,
              assignedResources: a0.assignedResources as any,
              projectId: a0.projectId,
            } as any,
          });
        }
        created += 1;
      }
      if (!opts.dryRun) {
        await prisma.activity.delete({ where: { id: a0.id } });
      }
    }

    // (b) Reassign by strong name match when current deliverable looks wrong (fallback/unassigned) or weak match.
    const refreshedFragnet = await prisma.fragnet.findUnique({
      where: { id: f.id },
      include: { activities: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    const activitiesNow = (refreshedFragnet?.activities ?? []) as any as ActivityRow[];

    for (const a of activitiesNow) {
      // If already on a deliverable in this fragnet, keep unless a much stronger match exists.
      const currentDeliverable = deliverableById.get(a.deliverableId);
      const currentOk = currentDeliverable?.fragnetId === f.id;

      const aTok = tokens(a.name);
      let best: { deliverableId: string; score: number } | null = null;
      for (const d of deliverables) {
        const score = jaccard(aTok, deliverableTokenMap.get(d.id)!);
        if (!best || score > best.score) best = { deliverableId: d.id, score };
      }

      if (!best) continue;
      const strong = best.score >= 0.35; // tuned conservative; avoids random reassignment

      if (!currentOk && strong) {
        if (opts.debug) {
          console.log(
            `[rebuild] Reassign by name match: activity ${a.id} "${a.name}" → deliverable ${best.deliverableId} (score=${best.score.toFixed(2)})`
          );
        }
        if (!opts.dryRun) {
          await prisma.activity.update({ where: { id: a.id }, data: { deliverableId: best.deliverableId } });
        }
        updated += 1;
      } else if (currentOk && strong) {
        // Only move if the alternative is significantly better than current.
        const currentScore = jaccard(aTok, deliverableTokenMap.get(a.deliverableId) ?? new Set());
        if (best.deliverableId !== a.deliverableId && best.score >= currentScore + 0.25) {
          if (opts.debug) {
            console.log(
              `[rebuild] Move to better match: activity ${a.id} "${a.name}" ${a.deliverableId}→${best.deliverableId} (${currentScore.toFixed(2)}→${best.score.toFixed(2)})`
            );
          }
          if (!opts.dryRun) {
            await prisma.activity.update({ where: { id: a.id }, data: { deliverableId: best.deliverableId } });
          }
          updated += 1;
        }
      }
    }

    if (opts.debug) {
      const counts = new Map<string, number>();
      const finalActs = (await prisma.activity.findMany({ where: { fragnetId: f.id }, select: { id: true, deliverableId: true } })) as any[];
      for (const a of finalActs) counts.set(a.deliverableId, (counts.get(a.deliverableId) ?? 0) + 1);
      for (const d of deliverables) {
        console.log(`[rebuild] deliverable "${d.name}" activities=${counts.get(d.id) ?? 0}`);
      }
    }
  }

  // Final: validate (fail hard).
  await validateActivityAssignments(sid);

  // Ensure no orphan activities under the project-level unassigned deliverable remain in any fragnet scope.
  // (Allowed as fallback only when no strong match exists; still linked to a deliverable as required.)
  return { updated, created, standardId: sid };
}

