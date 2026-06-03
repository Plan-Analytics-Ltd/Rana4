import type { DeliverableClassification } from "@prisma/client";
import { prisma } from "../../utils/prisma.js";

function n(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

type Rule = { classification: DeliverableClassification; patterns: RegExp[] };

const RULES: Rule[] = [
  {
    classification: "CLIENT_APPROVAL",
    patterns: [/client\s+approval/i, /\bapproval\b/i, /\bsign[-\s]?off\b/i],
  },
  {
    classification: "REGULATORY_APPROVAL",
    patterns: [/\b(regulatory|authority|permit|planning|building\s*control)\b/i],
  },
  {
    classification: "TECHNICAL_ASSURANCE",
    patterns: [/\btechnical\s+assurance\b/i, /\bpeer\s+review\b/i, /\bdesign\s+assurance\b/i],
  },
  {
    classification: "QUALITY_ASSURANCE",
    patterns: [/\bqa\b/i, /\bquality\s+assurance\b/i, /\binspection\b/i, /\btest\s+plan\b/i],
  },
  {
    classification: "INFORMATION_ISSUE",
    patterns: [/\bissue\b/i, /\binformation\s+issue\b/i, /\bdrawing\s+issue\b/i, /\bdocument\s+issue\b/i],
  },
  { classification: "REVIEW", patterns: [/\breview\b/i, /\bgate\b/i] },
  { classification: "DESIGN", patterns: [/\bdesign\b/i, /\bconcept\b/i] },
  { classification: "COORDINATION", patterns: [/\bcoordination\b/i, /\bclash\b/i, /\bmep\b/i] },
  { classification: "PROCUREMENT", patterns: [/\bprocurement\b/i, /\btender\b/i, /\bpackage\b/i] },
  { classification: "CONSTRUCTION", patterns: [/\bconstruction\b/i, /\bon\s*site\b/i, /\binstall(ation)?\b/i] },
  { classification: "COMMISSIONING", patterns: [/\bcommission(ing)?\b/i, /\btesting\s+and\s+commissioning\b/i] },
  { classification: "HANDOVER", patterns: [/\bhandover\b/i, /\bas[-\s]?built\b/i, /\bom\b/i] },
];

export function classifyDeliverableName(name: string): DeliverableClassification {
  const s = n(name);
  if (!s) return "OTHER";
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(s))) return rule.classification;
  }
  return "OTHER";
}

/**
 * Set classification for deliverables that are currently null.
 * Does NOT overwrite manual classification.
 */
export async function autoClassifyDeliverablesForProject(projectId: string, companyId: string): Promise<number> {
  const deliverables = await prisma.deliverable.findMany({
    where: { projectId, companyId, classification: null },
    select: { id: true, name: true },
  });

  let updated = 0;
  for (const d of deliverables) {
    const classification = classifyDeliverableName(d.name);
    const res = await prisma.deliverable.updateMany({
      where: { id: d.id, companyId, classification: null },
      data: { classification },
    });
    updated += res.count;
  }
  return updated;
}

export async function resolveDeliverableClassification(args: {
  companyId: string;
  deliverableId?: string | null;
  deliverableName: string;
}): Promise<DeliverableClassification> {
  if (args.deliverableId) {
    const existing = await prisma.deliverable.findFirst({
      where: { id: args.deliverableId, companyId: args.companyId },
      select: { classification: true },
    });
    if (existing?.classification) return existing.classification;
  }
  return classifyDeliverableName(args.deliverableName);
}

export async function backfillSnapshotDeliverableClassificationsForSnapshot(snapshotId: string, companyId: string) {
  const rows = await prisma.deliverableSnapshot.findMany({
    where: { snapshotId, snapshot: { companyId }, classification: null },
    select: { id: true, name: true, deliverableId: true },
  });
  let updated = 0;
  for (const r of rows) {
    const classification = await resolveDeliverableClassification({
      companyId,
      deliverableId: r.deliverableId,
      deliverableName: r.name,
    });
    const res = await prisma.deliverableSnapshot.updateMany({
      where: { id: r.id, classification: null },
      data: { classification },
    });
    updated += res.count;
  }
  return updated;
}

