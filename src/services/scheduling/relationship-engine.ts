import type { RelationshipType } from "@prisma/client";
import {
  addWorkingDays,
  subtractWorkingDays,
  toDayIndex,
  type WorkCalendar,
} from "./calendar.service.js";

export type ForwardBounds = {
  minEarlyStart?: Date;
  minEarlyFinish?: Date;
};

export type BackwardBounds = {
  maxLateFinish?: Date;
  maxLateStart?: Date;
};

/**
 * Forward-pass: earliest dates the successor must respect (lower bounds).
 * Lag is in working days.
 */
export function forwardSuccessorBounds(
  type: RelationshipType,
  predEarlyStart: Date,
  predEarlyFinish: Date,
  lag: number,
  calendar: WorkCalendar
): ForwardBounds {
  const lagDays = Math.max(0, Math.trunc(lag));
  switch (type) {
    case "FS":
      return {
        minEarlyStart: addWorkingDays(predEarlyFinish, 1 + lagDays, calendar),
      };
    case "SS":
      return {
        minEarlyStart: addWorkingDays(predEarlyStart, lagDays, calendar),
      };
    case "FF":
      return {
        minEarlyFinish: addWorkingDays(predEarlyFinish, lagDays, calendar),
      };
    case "SF":
      return {
        minEarlyFinish: addWorkingDays(predEarlyStart, lagDays, calendar),
      };
    default:
      return {};
  }
}

/**
 * Backward-pass: latest dates the predecessor must respect (upper bounds).
 */
export function backwardPredecessorBounds(
  type: RelationshipType,
  succLateStart: Date,
  succLateFinish: Date,
  lag: number,
  calendar: WorkCalendar
): BackwardBounds {
  const lagDays = Math.max(0, Math.trunc(lag));
  switch (type) {
    case "FS":
      return {
        maxLateFinish: subtractWorkingDays(succLateStart, 1 + lagDays, calendar),
      };
    case "SS":
      return {
        maxLateStart: subtractWorkingDays(succLateStart, lagDays, calendar),
      };
    case "FF":
      return {
        maxLateFinish: subtractWorkingDays(succLateFinish, lagDays, calendar),
      };
    case "SF":
      return {
        maxLateFinish: subtractWorkingDays(succLateFinish, lagDays, calendar),
      };
    default:
      return {};
  }
}

export function maxDate(a: Date, b: Date): Date {
  return toDayIndex(a) >= toDayIndex(b) ? a : b;
}

export function minDate(a: Date, b: Date): Date {
  return toDayIndex(a) <= toDayIndex(b) ? a : b;
}
