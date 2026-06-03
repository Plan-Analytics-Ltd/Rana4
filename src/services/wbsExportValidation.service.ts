import type { GeneratedWbs } from "./wbsGenerate.service.js";

export type WbsExportValidationIssue = {
  code: string;
  message: string;
};

/** Minimal fragnet shape for export-time checks (no UI). */
export type FragnetExportValidationInput = {
  id: string;
  deliverables: { id: string; fragnetId: string | null }[];
  activities: { id: string; name: string; deliverableId: string }[];
};

/**
 * Ensures every activity on the fragnet has a non-empty deliverable_id that points
 * to a deliverable row on this same fragnet (no orphans / cross-fragnet links).
 */
export function validateFragnetForWbsExport(fragnet: FragnetExportValidationInput): WbsExportValidationIssue[] {
  const issues: WbsExportValidationIssue[] = [];
  const deliverableById = new Map(fragnet.deliverables.map((d) => [d.id, d]));
  const deliverableIdsOnFragnet = new Set(
    fragnet.deliverables.filter((d) => d.fragnetId === fragnet.id).map((d) => d.id)
  );
  for (const a of fragnet.activities) {
    const did = String(a.deliverableId ?? "").trim();
    if (did) deliverableIdsOnFragnet.add(did);
  }

  for (const d of fragnet.deliverables) {
    if (d.fragnetId != null && d.fragnetId !== fragnet.id) {
      issues.push({
        code: "DELIVERABLE_NOT_ON_STAGE",
        message: `Deliverable ${d.id} is not assigned to this stage (fragnet ${fragnet.id})`,
      });
    }
  }

  for (const a of fragnet.activities) {
    const did = String(a.deliverableId ?? "").trim();
    if (!did) {
      issues.push({
        code: "ACTIVITY_MISSING_DELIVERABLE",
        message: `Activity "${a.name}" (${a.id}) has no deliverable_id`,
      });
      continue;
    }
    const d = deliverableById.get(did);
    if (!d) {
      issues.push({
        code: "ORPHAN_ACTIVITY",
        message: `Activity "${a.name}" (${a.id}) references unknown deliverable ${did}`,
      });
      continue;
    }
    if (!deliverableIdsOnFragnet.has(did)) {
      issues.push({
        code: "ORPHAN_ACTIVITY",
        message: `Activity "${a.name}" (${a.id}) deliverable ${did} is not attached to this fragnet`,
      });
    }
  }

  return issues;
}

/**
 * Structural rules for P6 / XER export: Project → Stage → Deliverable only (no deliverables directly under root
 * when stages exist). Same source deliverable name may repeat under one stage; WBS display names are uniquified per parent.
 */
export function validateGeneratedWbsForP6Export(wbs: GeneratedWbs): WbsExportValidationIssue[] {
  const issues: WbsExportValidationIssue[] = [];
  const hasFragnet = wbs.wbs_nodes.some((n) => n.kind === "FRAGNET");

  if (hasFragnet) {
    for (const n of wbs.wbs_nodes) {
      if (n.kind === "DELIVERABLE" && n.parent_wbs_id === wbs.project_wbs.wbs_id) {
        issues.push({
          code: "DELIVERABLE_UNDER_PROJECT_ROOT",
          message: `WBS node ${n.wbs_id} is a deliverable attached directly to the project root while stage (fragnet) nodes exist. Expected Project → Stage → Deliverable.`,
        });
      }
    }
  }

  return issues;
}

/** Invariant: each activity under a slice lists the same deliverable_id as the slice; map matches slices. */
export function validateGeneratedWbsStructure(wbs: GeneratedWbs): WbsExportValidationIssue[] {
  const issues: WbsExportValidationIssue[] = [];
  for (const slice of wbs.deliverable_wbs_list) {
    if (wbs.deliverableIdToWbsId.get(slice.deliverable_id) !== slice.wbs_id) {
      issues.push({
        code: "WBS_MAP_SLICE_MISMATCH",
        message: `deliverableIdToWbsId does not match slice wbs_id for deliverable ${slice.deliverable_id}`,
      });
    }
    for (const act of slice.activities) {
      if (act.deliverableId !== slice.deliverable_id) {
        issues.push({
          code: "ACTIVITY_DELIVERABLE_MISMATCH",
          message: `Activity ${act.id} has deliverableId ${act.deliverableId} but is under slice ${slice.deliverable_id}`,
        });
        continue;
      }
      const mapped = wbs.deliverableIdToWbsId.get(act.deliverableId);
      if (mapped === undefined || mapped !== slice.wbs_id) {
        issues.push({
          code: "ACTIVITY_WBS_MAP_MISSING",
          message: `Activity ${act.id}: deliverableIdToWbsId missing or wrong for deliverable ${act.deliverableId}`,
        });
      }
    }
  }
  return issues;
}
