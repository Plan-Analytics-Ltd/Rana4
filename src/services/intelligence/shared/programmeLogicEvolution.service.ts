import type { RelationshipType } from "@prisma/client";
import {
  buildLogicEventDescription,
  logicEventStoryBullet,
} from "./plannerLanguage.service.js";

export type ProgrammeLogicChangeType =
  | "RELATIONSHIP_ADDED"
  | "RELATIONSHIP_REMOVED"
  | "RELATIONSHIP_TYPE_CHANGED"
  | "LAG_INCREASED"
  | "LAG_DECREASED"
  | "LAG_INTRODUCED"
  | "LAG_REMOVED"
  | "FLOAT_LOST"
  | "FLOAT_GAINED"
  | "BECAME_CRITICAL"
  | "LEFT_CRITICAL"
  | "NEGATIVE_FLOAT_INTRODUCED"
  | "APPROACHING_CRITICAL"
  | "RELATIONSHIP_COUNT_CHANGED";

export type ProgrammeLogicEvent = {
  type: ProgrammeLogicChangeType;
  activityCode: string;
  activityName: string | null;
  description: string;
  storyBullet: string | null;
  predecessorCode?: string;
  predecessorName?: string | null;
  successorCode?: string;
  relationshipType?: string;
  lagDays?: number;
  previousLagDays?: number;
  floatBefore?: number | null;
  floatAfter?: number | null;
};

export type SnapshotLogicActivity = {
  activityCode: string;
  name: string | null;
  totalFloat: number | null;
  freeFloat: number | null;
  isCritical: boolean;
  finishDate: Date | null;
};

export type SnapshotLogicRelationship = {
  predecessorActivityCode: string;
  successorActivityCode: string;
  relationshipType: RelationshipType;
  lag: number;
};

export type SnapshotLogicState = {
  snapshotId: string;
  label: string;
  activities: SnapshotLogicActivity[];
  relationships: SnapshotLogicRelationship[];
};

export type RevisionProgrammeIntelligence = {
  revisionIndex: number;
  revisionLabel: string;
  snapshotId: string;
  durationDays: number | null;
  durationChangeDays: number | null;
  relationshipCount: number;
  relationshipCountChange: number | null;
  relationshipDensity: number | null;
  events: ProgrammeLogicEvent[];
  plannerObservations: string[];
  storyBullets: string[];
  hasMeaningfulChanges: boolean;
};

const APPROACHING_CRITICAL_THRESHOLD = 5;

const PLANNER_VISIBLE_EVENT_TYPES = new Set<ProgrammeLogicChangeType>([
  "RELATIONSHIP_ADDED",
  "RELATIONSHIP_REMOVED",
  "RELATIONSHIP_TYPE_CHANGED",
  "LAG_INCREASED",
  "LAG_DECREASED",
  "LAG_INTRODUCED",
  "LAG_REMOVED",
  "FLOAT_LOST",
  "FLOAT_GAINED",
  "BECAME_CRITICAL",
  "LEFT_CRITICAL",
  "NEGATIVE_FLOAT_INTRODUCED",
  "APPROACHING_CRITICAL",
]);

function relIdentityKey(pred: string, succ: string, type: string): string {
  return `${pred.toUpperCase()}\x1d${succ.toUpperCase()}\x1d${type}`;
}

function relFullKey(pred: string, succ: string, type: string, lag: number): string {
  return `${relIdentityKey(pred, succ, type)}\x1d${lag}`;
}

function activityNameMap(activities: SnapshotLogicActivity[]): Map<string, string | null> {
  return new Map(activities.map((a) => [a.activityCode.toUpperCase(), a.name]));
}

function filterRelationshipsForActivities(
  relationships: SnapshotLogicRelationship[],
  activityCodes: Set<string>
): SnapshotLogicRelationship[] {
  return relationships.filter(
    (r) =>
      activityCodes.has(r.successorActivityCode.toUpperCase()) ||
      activityCodes.has(r.predecessorActivityCode.toUpperCase())
  );
}

function relationshipDensity(relCount: number, activityCount: number): number | null {
  if (activityCount <= 0) return null;
  return Math.round((relCount / activityCount) * 100) / 100;
}

function makeEvent(
  base: Omit<ProgrammeLogicEvent, "description" | "storyBullet">
): ProgrammeLogicEvent {
  const description = buildLogicEventDescription({
    type: base.type,
    activityName: base.activityName,
    activityCode: base.activityCode,
    predecessorName: base.predecessorName,
    predecessorCode: base.predecessorCode,
    relationshipType: base.relationshipType,
    lagDays: base.lagDays,
    previousLagDays: base.previousLagDays,
    floatBefore: base.floatBefore,
    floatAfter: base.floatAfter,
  });
  return {
    ...base,
    description,
    storyBullet: logicEventStoryBullet(base.type, base.relationshipType),
  };
}

/**
 * Compare two snapshot logic states for activities in scope.
 * Deterministic — describes what changed in imported evidence only.
 */
export function compareSnapshotProgrammeLogic(args: {
  previous: SnapshotLogicState;
  current: SnapshotLogicState;
  activityCodes: Set<string>;
}): ProgrammeLogicEvent[] {
  const events: ProgrammeLogicEvent[] = [];
  const names = activityNameMap([...args.previous.activities, ...args.current.activities]);

  const prevActs = new Map(
    args.previous.activities
      .filter((a) => args.activityCodes.has(a.activityCode.toUpperCase()))
      .map((a) => [a.activityCode.toUpperCase(), a])
  );
  const currActs = new Map(
    args.current.activities
      .filter((a) => args.activityCodes.has(a.activityCode.toUpperCase()))
      .map((a) => [a.activityCode.toUpperCase(), a])
  );

  for (const [code, curr] of currActs) {
    const prev = prevActs.get(code);
    if (!prev) continue;

    const prevTf = prev.totalFloat;
    const currTf = curr.totalFloat;
    if (prevTf != null && currTf != null && currTf < prevTf) {
      const lost = prevTf - currTf;
      if (lost > 0) {
        events.push(
          makeEvent({
            type: "FLOAT_LOST",
            activityCode: curr.activityCode,
            activityName: curr.name,
            floatBefore: prevTf,
            floatAfter: currTf,
          })
        );
      }
    } else if (prevTf != null && currTf != null && currTf > prevTf) {
      events.push(
        makeEvent({
          type: "FLOAT_GAINED",
          activityCode: curr.activityCode,
          activityName: curr.name,
          floatBefore: prevTf,
          floatAfter: currTf,
        })
      );
    }

    if (prevTf != null && prevTf >= 0 && currTf != null && currTf < 0) {
      events.push(
        makeEvent({
          type: "NEGATIVE_FLOAT_INTRODUCED",
          activityCode: curr.activityCode,
          activityName: curr.name,
          floatBefore: prevTf,
          floatAfter: currTf,
        })
      );
    }

    if (!prev.isCritical && curr.isCritical) {
      events.push(
        makeEvent({
          type: "BECAME_CRITICAL",
          activityCode: curr.activityCode,
          activityName: curr.name,
          floatBefore: prevTf,
          floatAfter: currTf,
        })
      );
    } else if (prev.isCritical && !curr.isCritical) {
      events.push(
        makeEvent({
          type: "LEFT_CRITICAL",
          activityCode: curr.activityCode,
          activityName: curr.name,
          floatBefore: prevTf,
          floatAfter: currTf,
        })
      );
    }

    if (
      !curr.isCritical &&
      currTf != null &&
      currTf >= 0 &&
      currTf <= APPROACHING_CRITICAL_THRESHOLD &&
      (prevTf == null || prevTf > APPROACHING_CRITICAL_THRESHOLD)
    ) {
      events.push(
        makeEvent({
          type: "APPROACHING_CRITICAL",
          activityCode: curr.activityCode,
          activityName: curr.name,
          floatBefore: prevTf,
          floatAfter: currTf,
        })
      );
    }
  }

  const prevRels = filterRelationshipsForActivities(args.previous.relationships, args.activityCodes);
  const currRels = filterRelationshipsForActivities(args.current.relationships, args.activityCodes);

  const prevByIdentity = new Map<string, SnapshotLogicRelationship>();
  for (const r of prevRels) {
    prevByIdentity.set(
      relIdentityKey(r.predecessorActivityCode, r.successorActivityCode, r.relationshipType),
      r
    );
  }
  const currByIdentity = new Map<string, SnapshotLogicRelationship>();
  for (const r of currRels) {
    currByIdentity.set(
      relIdentityKey(r.predecessorActivityCode, r.successorActivityCode, r.relationshipType),
      r
    );
  }

  const prevFull = new Set(
    prevRels.map((r) =>
      relFullKey(r.predecessorActivityCode, r.successorActivityCode, r.relationshipType, r.lag)
    )
  );

  for (const r of currRels) {
    const idKey = relIdentityKey(
      r.predecessorActivityCode,
      r.successorActivityCode,
      r.relationshipType
    );
    const fullKey = relFullKey(
      r.predecessorActivityCode,
      r.successorActivityCode,
      r.relationshipType,
      r.lag
    );
    if (!prevFull.has(fullKey)) {
      const prevRel = prevByIdentity.get(idKey);
      const predName = names.get(r.predecessorActivityCode.toUpperCase()) ?? null;
      const succCode = r.successorActivityCode;
      const succName = names.get(succCode.toUpperCase()) ?? null;

      if (!prevRel) {
        events.push(
          makeEvent({
            type: "RELATIONSHIP_ADDED",
            activityCode: succCode,
            activityName: succName,
            predecessorCode: r.predecessorActivityCode,
            predecessorName: predName,
            successorCode: succCode,
            relationshipType: r.relationshipType,
            lagDays: r.lag,
          })
        );
        if (r.lag > 0) {
          events.push(
            makeEvent({
              type: "LAG_INTRODUCED",
              activityCode: succCode,
              activityName: succName,
              predecessorCode: r.predecessorActivityCode,
              predecessorName: predName,
              relationshipType: r.relationshipType,
              lagDays: r.lag,
            })
          );
        }
      } else if (prevRel.lag !== r.lag) {
        const delta = r.lag - prevRel.lag;
        events.push(
          makeEvent({
            type: delta > 0 ? "LAG_INCREASED" : "LAG_DECREASED",
            activityCode: succCode,
            activityName: succName,
            predecessorCode: r.predecessorActivityCode,
            predecessorName: predName,
            relationshipType: r.relationshipType,
            lagDays: r.lag,
            previousLagDays: prevRel.lag,
          })
        );
      }
    }
  }

  for (const r of prevRels) {
    const idKey = relIdentityKey(
      r.predecessorActivityCode,
      r.successorActivityCode,
      r.relationshipType
    );
    if (!currByIdentity.has(idKey)) {
      const succName = names.get(r.successorActivityCode.toUpperCase()) ?? null;
      const predName = names.get(r.predecessorActivityCode.toUpperCase()) ?? null;
      events.push(
        makeEvent({
          type: "RELATIONSHIP_REMOVED",
          activityCode: r.successorActivityCode,
          activityName: succName,
          predecessorCode: r.predecessorActivityCode,
          predecessorName: predName,
          successorCode: r.successorActivityCode,
          relationshipType: r.relationshipType,
          lagDays: r.lag,
        })
      );
      if (r.lag > 0) {
        events.push(
          makeEvent({
            type: "LAG_REMOVED",
            activityCode: r.successorActivityCode,
            activityName: succName,
            predecessorCode: r.predecessorActivityCode,
            predecessorName: predName,
            relationshipType: r.relationshipType,
            previousLagDays: r.lag,
          })
        );
      }
    }
  }

  const prevTypes = new Map<string, string>();
  const currTypes = new Map<string, string>();
  for (const r of prevRels) {
    const pairKey = `${r.predecessorActivityCode.toUpperCase()}\x1d${r.successorActivityCode.toUpperCase()}`;
    prevTypes.set(pairKey, r.relationshipType);
  }
  for (const r of currRels) {
    const pairKey = `${r.predecessorActivityCode.toUpperCase()}\x1d${r.successorActivityCode.toUpperCase()}`;
    currTypes.set(pairKey, r.relationshipType);
  }
  for (const [pairKey, currType] of currTypes) {
    const prevType = prevTypes.get(pairKey);
    if (prevType && prevType !== currType) {
      const [pred, succ] = pairKey.split("\x1d");
      events.push(
        makeEvent({
          type: "RELATIONSHIP_TYPE_CHANGED",
          activityCode: succ,
          activityName: names.get(succ) ?? null,
          predecessorCode: pred,
          predecessorName: names.get(pred) ?? null,
          successorCode: succ,
          relationshipType: currType,
        })
      );
    }
  }

  return events;
}

const STORY_PRIORITY: Record<string, number> = {
  BECAME_CRITICAL: 1,
  LEFT_CRITICAL: 2,
  NEGATIVE_FLOAT_INTRODUCED: 3,
  RELATIONSHIP_ADDED: 4,
  RELATIONSHIP_REMOVED: 5,
  RELATIONSHIP_TYPE_CHANGED: 6,
  FLOAT_LOST: 7,
  FLOAT_GAINED: 8,
  APPROACHING_CRITICAL: 9,
  LAG_INTRODUCED: 10,
  LAG_INCREASED: 11,
  LAG_DECREASED: 12,
  LAG_REMOVED: 13,
};

export function buildPlannerObservationsFromLogicEvents(events: ProgrammeLogicEvent[]): string[] {
  const visible = events.filter((e) => PLANNER_VISIBLE_EVENT_TYPES.has(e.type));
  const sorted = [...visible].sort(
    (a, b) => (STORY_PRIORITY[a.type] ?? 99) - (STORY_PRIORITY[b.type] ?? 99)
  );

  const observations: string[] = [];
  const seen = new Set<string>();

  for (const e of sorted) {
    if (seen.has(e.description)) continue;
    seen.add(e.description);
    observations.push(e.description);
  }

  return observations.slice(0, 12);
}

export function buildStoryBulletsFromLogicEvents(events: ProgrammeLogicEvent[]): string[] {
  const bullets: string[] = [];
  const seen = new Set<string>();

  for (const e of events) {
    if (!e.storyBullet || seen.has(e.storyBullet)) continue;
    seen.add(e.storyBullet);
    bullets.push(e.storyBullet);
  }

  return bullets.slice(0, 8);
}

export function buildProgrammeLogicSummary(
  revisions: RevisionProgrammeIntelligence[]
): string | null {
  const meaningful = revisions.filter((r) => r.hasMeaningfulChanges);
  const allBullets = meaningful.flatMap((r) => r.storyBullets);
  if (allBullets.length === 0) {
    const durationOnly = meaningful.some(
      (r) => r.durationChangeDays != null && r.durationChangeDays !== 0
    );
    if (durationOnly) return null;
    return meaningful.length > 1
      ? "No relationship, lag, float, or criticality changes recorded across revisions."
      : null;
  }

  const relAdds = allBullets.filter((b) => /relationship introduced/i.test(b)).length;
  const becameCritical = allBullets.filter((b) => /became critical/i.test(b)).length;
  const floatReduced = allBullets.filter((b) => /float reduced/i.test(b)).length;
  const floatIncreased = allBullets.filter((b) => /float increased/i.test(b)).length;
  const depsRemoved = allBullets.filter((b) => /dependencies removed/i.test(b)).length;

  const parts: string[] = [];
  if (relAdds > 0) parts.push(`${relAdds} new relationship${relAdds === 1 ? "" : "s"}`);
  if (depsRemoved > 0) parts.push("dependencies removed");
  if (floatIncreased > 0) parts.push("scheduling flexibility increased");
  if (floatReduced > 0) parts.push("scheduling flexibility reduced");
  if (becameCritical > 0)
    parts.push(`${becameCritical} activit${becameCritical === 1 ? "y" : "ies"} became critical`);

  if (parts.length === 0) return "Programme logic changed across revisions.";
  return `Across revisions: ${parts.join("; ")}.`;
}

export function computeRevisionProgrammeIntelligence(args: {
  revisions: Array<{
    snapshotId: string;
    label: string;
    durationDays: number | null;
    durationChangeDays: number | null;
    logicState: SnapshotLogicState;
  }>;
  deliverableActivityCodes: Set<string>;
}): RevisionProgrammeIntelligence[] {
  const output: RevisionProgrammeIntelligence[] = [];

  for (let i = 0; i < args.revisions.length; i++) {
    const rev = args.revisions[i]!;
    const scopedRels = filterRelationshipsForActivities(
      rev.logicState.relationships,
      args.deliverableActivityCodes
    );
    const scopedActCount = [...args.deliverableActivityCodes].filter((c) =>
      rev.logicState.activities.some((a) => a.activityCode.toUpperCase() === c)
    ).length;

    let events: ProgrammeLogicEvent[] = [];
    let relationshipCountChange: number | null = null;

    if (i > 0) {
      const prev = args.revisions[i - 1]!;
      const prevScoped = filterRelationshipsForActivities(
        prev.logicState.relationships,
        args.deliverableActivityCodes
      );
      relationshipCountChange = scopedRels.length - prevScoped.length;
      events = compareSnapshotProgrammeLogic({
        previous: prev.logicState,
        current: rev.logicState,
        activityCodes: args.deliverableActivityCodes,
      });
      if (relationshipCountChange !== 0) {
        events.push({
          type: "RELATIONSHIP_COUNT_CHANGED",
          activityCode: "",
          activityName: null,
          description: "",
          storyBullet: null,
        });
      }
    }

    const plannerObservations = buildPlannerObservationsFromLogicEvents(events);
    const storyBullets = buildStoryBulletsFromLogicEvents(events);

    if (
      rev.durationChangeDays != null &&
      rev.durationChangeDays !== 0 &&
      events.every((e) => !e.type.startsWith("DURATION"))
    ) {
      const dir = rev.durationChangeDays > 0 ? "increased" : "reduced";
      plannerObservations.unshift(
        `Remaining work ${dir} by ${Math.abs(rev.durationChangeDays)} days (${rev.durationDays ?? "—"} days remaining in this revision).`
      );
    } else if (rev.durationChangeDays === 0 || rev.durationChangeDays == null) {
      const hasLogic = events.some((e) => PLANNER_VISIBLE_EVENT_TYPES.has(e.type));
      if (hasLogic) {
        plannerObservations.push("Remaining work was unchanged in this revision.");
      }
    }

    const hasMeaningfulChanges =
      i === 0
        ? false
        : events.some((e) => PLANNER_VISIBLE_EVENT_TYPES.has(e.type)) ||
          (rev.durationChangeDays != null && rev.durationChangeDays !== 0);

    output.push({
      revisionIndex: i,
      revisionLabel: rev.label,
      snapshotId: rev.snapshotId,
      durationDays: rev.durationDays,
      durationChangeDays: rev.durationChangeDays,
      relationshipCount: scopedRels.length,
      relationshipCountChange,
      relationshipDensity: relationshipDensity(scopedRels.length, scopedActCount),
      events,
      plannerObservations,
      storyBullets,
      hasMeaningfulChanges,
    });
  }

  return output;
}
