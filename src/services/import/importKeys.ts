/** Lookup key prefix for deliverables imported without a fragnet (project-level / unassigned). */
export const IMPORT_UNASSIGNED_FRAGNET_KEY = "__unassigned__";

export function normalizeImportName(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

/** Stable key for deliverable maps: unassigned vs fragnet-scoped. */
export function importDeliverableKey(fragnetName: string | null | undefined, deliverableName: string): string {
  const fn = normalizeImportName(String(fragnetName ?? ""));
  const dn = normalizeImportName(deliverableName);
  if (!fn) return `${IMPORT_UNASSIGNED_FRAGNET_KEY}||${dn}`;
  return `${fn}||${dn}`;
}
