import type { ActivityCodeCatalogForExport } from "./activityCodeCatalog.service.js";

/**
 * Same merge semantics as the P6 TASK spreadsheet: deliverable defaults + activity overrides by type.
 */
export function mergeInheritedAndOwnActivityAssignments(
  catalog: ActivityCodeCatalogForExport,
  ownAssignmentKey: string | null,
  inheritDeliverableId: string | null
): { typeId: string; codeId: string }[] {
  const inherited =
    inheritDeliverableId != null && String(inheritDeliverableId).trim() !== ""
      ? catalog.assignmentsByCanonicalActivityId.get(inheritDeliverableId) ?? []
      : [];
  const own =
    ownAssignmentKey != null && String(ownAssignmentKey).trim() !== ""
      ? catalog.assignmentsByCanonicalActivityId.get(ownAssignmentKey) ?? []
      : [];
  const mergedByType = new Map<string, { typeId: string; codeId: string }>();
  for (const a of inherited) mergedByType.set(a.typeId, a);
  for (const a of own) mergedByType.set(a.typeId, a);
  return [...mergedByType.values()];
}
