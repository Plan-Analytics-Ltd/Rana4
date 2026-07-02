import type { ProgrammeState } from "@prisma/client";
import {
  buildDeliverableFingerprint,
  type ActivityCompositionInput,
  type DeliverableFingerprint,
} from "../matching/deliverableFingerprint.service.js";
import {
  resolveDeliverableDiscipline,
  resolveDominantFragnetId,
  resolveSnapshotDeliverableStage,
  type FragnetActivityLink,
} from "../shared/deliverableSnapshotContext.service.js";

export type HistoricalDeliverableSnapshotInput = {
  name: string;
  classification?: string | null;
  fragnetId?: string | null;
  parentWbs?: string | null;
  wbsPath?: string | null;
  stage?: string | null;
  discipline?: string | null;
  classificationTags?: Record<string, unknown> | null;
  deliverableId?: string | null;
};

export type HistoricalProgrammeSnapshotInput = {
  programmeState?: ProgrammeState | null;
  stage?: string | null;
  disciplineTags?: unknown;
  projectProfileStage?: string | null;
  projectProfilePrimaryRibaStage?: string | null;
};

/**
 * Build a historical deliverable fingerprint with explicit precedence:
 *
 * WBS context:
 * 1. DeliverableSnapshot fragnetId / parentWbs / wbsPath (frozen at capture)
 * 2. Dominant fragnetId from linked ActivitySnapshots
 * 3. parentWbs from snapshot wbsPath when parentWbs absent
 *
 * Stage:
 * 1. DeliverableSnapshot.stage
 * 2. ProgrammeSnapshot.stage
 * 3. Project profile stage (passed in for repair reads; snapshot should already persist this)
 *
 * Discipline:
 * 1. DeliverableSnapshot.discipline
 * 2. classificationTags / programme disciplineTags / activity roll-up
 *
 * Activity composition & duration:
 * - Always from linked ActivitySnapshots (no snapshot override)
 */
export function buildHistoricalDeliverableFingerprint(args: {
  deliverableSnapshot: HistoricalDeliverableSnapshotInput;
  programmeSnapshot: HistoricalProgrammeSnapshotInput;
  linkedActivities: ActivityCompositionInput[];
  activityFragnetLinks?: FragnetActivityLink[];
}): DeliverableFingerprint {
  const { deliverableSnapshot: del, programmeSnapshot: prog } = args;
  const deliverableId = del.deliverableId ?? "";

  const rolledFragnetId =
    del.fragnetId ??
    (deliverableId
      ? resolveDominantFragnetId(deliverableId, args.activityFragnetLinks ?? [])
      : null);

  const parentWbs = del.parentWbs ?? del.wbsPath ?? null;

  const stage = resolveSnapshotDeliverableStage({
    deliverableStage: del.stage,
    programmeSnapshotStage: prog.stage,
    projectProfileStage: prog.projectProfileStage,
    projectProfilePrimaryRibaStage: prog.projectProfilePrimaryRibaStage,
    programmeState: prog.programmeState,
  });

  const discipline = resolveDeliverableDiscipline({
    snapshotDiscipline: del.discipline,
    classificationTags: del.classificationTags ?? null,
    programmeDisciplineTags: prog.disciplineTags,
    linkedActivities: args.linkedActivities.map((a) => ({
      classificationTags: a.classificationTags ?? null,
    })),
  });

  return buildDeliverableFingerprint({
    deliverableName: del.name,
    classification: del.classification ?? null,
    fragnetId: rolledFragnetId,
    parentWbs,
    stage,
    discipline,
    programmeState: prog.programmeState ?? null,
    activities: args.linkedActivities,
  });
}
