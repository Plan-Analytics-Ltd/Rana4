"use client";

import type { Fragnet, Standard } from "@/lib/api";

export const PROJECT_LEVEL_LABEL = "Project-level deliverables";

const SYSTEM_STANDARD_NAMES = new Set(["project-level activities", "project-level deliverables"]);
const SYSTEM_FRAGNET_NAMES = new Set(["project-level / unassigned", "project-level deliverables"]);

export function isSystemManagedStandardName(name: string | null | undefined): boolean {
  return SYSTEM_STANDARD_NAMES.has(String(name ?? "").trim().toLowerCase());
}

export function isSystemManagedFragnetName(name: string | null | undefined): boolean {
  return SYSTEM_FRAGNET_NAMES.has(String(name ?? "").trim().toLowerCase());
}

export function filterUserVisibleStandards<T extends Pick<Standard, "name">>(standards: T[]): T[] {
  return standards.filter((standard) => !isSystemManagedStandardName(standard.name));
}

export function filterUserVisibleFragnets<T extends Pick<Fragnet, "name">>(fragnets: T[]): T[] {
  return fragnets.filter((fragnet) => !isSystemManagedFragnetName(fragnet.name));
}
