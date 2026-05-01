/**
 * Stable P6 resource row order: used for RSRC / XER rows and for assigning
 * new PLARES-N short names so they align with alphabetical resource lists in P6.
 */
export function compareResourcesForP6Order(
  a: { resourceName: string; resourceType: string },
  b: { resourceName: string; resourceType: string }
): number {
  const n = String(a.resourceName).localeCompare(String(b.resourceName));
  if (n !== 0) return n;
  return String(a.resourceType).localeCompare(String(b.resourceType));
}
