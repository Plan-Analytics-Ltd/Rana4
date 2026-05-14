import { prisma } from "../utils/prisma.js";

export type ActivityCodeCatalogForExport = {
  types: { id: string; slug: string; name: string; shortName: string | null; seqNum: number }[];
  codes: {
    id: string;
    typeId: string;
    parentId: string | null;
    name: string;
    shortName: string | null;
    seqNum: number;
    color: string | null;
  }[];
  /**
   * Keys are activity ids OR deliverable ids. Export merges deliverable-level assignments onto every
   * activity TASK row in the same deliverable block (activity-specific codes override by type).
   */
  assignmentsByCanonicalActivityId: Map<string, { typeId: string; codeId: string }[]>;
};

async function expandCodeAncestors(companyId: string, seedCodeIds: Set<string>): Promise<Set<string>> {
  const out = new Set(seedCodeIds);
  let frontier = [...seedCodeIds];
  while (frontier.length > 0) {
    const rows = await prisma.activityCode.findMany({
      where: { companyId, id: { in: frontier } },
      select: { parentId: true },
    });
    frontier = [];
    for (const r of rows) {
      if (r.parentId && !out.has(r.parentId)) {
        out.add(r.parentId);
        frontier.push(r.parentId);
      }
    }
  }
  return out;
}

/**
 * Load activity code types/values and assignments for activities and/or deliverables (P6 export).
 */
export async function loadActivityCodeCatalogForExport(
  companyId: string,
  opts: { activityIds: string[]; deliverableIds: string[] }
): Promise<ActivityCodeCatalogForExport> {
  const empty: ActivityCodeCatalogForExport = {
    types: [],
    codes: [],
    assignmentsByCanonicalActivityId: new Map(),
  };
  const activityIds = [...new Set(opts.activityIds.filter(Boolean))];
  const deliverableIds = [...new Set(opts.deliverableIds.filter(Boolean))];
  if (activityIds.length === 0 && deliverableIds.length === 0) return empty;

  const orClause: ({ activityId: { in: string[] } } | { deliverableId: { in: string[] } })[] = [];
  if (activityIds.length > 0) orClause.push({ activityId: { in: activityIds } });
  if (deliverableIds.length > 0) orClause.push({ deliverableId: { in: deliverableIds } });

  const assignments = await prisma.activityCodeAssignment.findMany({
    where: { companyId, OR: orClause },
  });
  if (assignments.length === 0) return empty;

  const assignmentsByCanonicalActivityId = new Map<string, { typeId: string; codeId: string }[]>();
  for (const a of assignments) {
    const key = a.activityId ?? a.deliverableId;
    if (!key) continue;
    const list = assignmentsByCanonicalActivityId.get(key) ?? [];
    list.push({ typeId: a.typeId, codeId: a.codeId });
    assignmentsByCanonicalActivityId.set(key, list);
  }

  const seedCodes = new Set(assignments.map((a) => a.codeId));
  const allCodeIds = await expandCodeAncestors(companyId, seedCodes);
  const codes = await prisma.activityCode.findMany({
    where: { companyId, id: { in: [...allCodeIds] } },
    orderBy: [{ typeId: "asc" }, { seqNum: "asc" }, { name: "asc" }],
  });

  const typeIdSet = new Set<string>();
  for (const a of assignments) typeIdSet.add(a.typeId);
  for (const c of codes) typeIdSet.add(c.typeId);

  const types = await prisma.activityCodeType.findMany({
    where: { companyId, id: { in: [...typeIdSet] } },
    orderBy: [{ seqNum: "asc" }, { name: "asc" }],
  });

  return {
    types: types.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      shortName: t.shortName,
      seqNum: t.seqNum,
    })),
    codes: codes.map((c) => ({
      id: c.id,
      typeId: c.typeId,
      parentId: c.parentId,
      name: c.name,
      shortName: c.shortName,
      seqNum: c.seqNum,
      color: c.color,
    })),
    assignmentsByCanonicalActivityId,
  };
}
