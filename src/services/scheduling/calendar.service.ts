/**
 * Default 5×8 calendar — all scheduling date math should go through this module.
 */

export type WorkCalendar = {
  id: string;
  hoursPerDay: number;
  workingWeekdays: Set<number>; // 0=Sun … 6=Sat
};

export const DEFAULT_CALENDAR: WorkCalendar = {
  id: "default-5x8",
  hoursPerDay: 8,
  workingWeekdays: new Set([1, 2, 3, 4, 5]),
};

/** UTC calendar day index (date-only, no time). */
export function toDayIndex(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}

export function fromDayIndex(index: number): Date {
  return new Date(index * 86_400_000);
}

export function startOfDay(d: Date): Date {
  return fromDayIndex(toDayIndex(d));
}

export function isWorkingDay(d: Date, calendar: WorkCalendar = DEFAULT_CALENDAR): boolean {
  const wd = fromDayIndex(toDayIndex(d)).getUTCDay();
  return calendar.workingWeekdays.has(wd);
}

export function nextWorkingDay(d: Date, calendar: WorkCalendar = DEFAULT_CALENDAR): Date {
  let cur = toDayIndex(d);
  for (let i = 0; i < 3660; i++) {
    const date = fromDayIndex(cur);
    if (isWorkingDay(date, calendar)) return date;
    cur++;
  }
  throw new Error("No working day found within horizon");
}

/**
 * Add `days` working days to `start` (inclusive of start when days >= 1).
 * duration=1 → same day; duration=5 → start + 4 working days forward.
 */
export function addWorkingDays(
  start: Date,
  days: number,
  calendar: WorkCalendar = DEFAULT_CALENDAR
): Date {
  if (days <= 0) return startOfDay(start);
  let cur = startOfDay(start);
  if (!isWorkingDay(cur, calendar)) cur = nextWorkingDay(cur, calendar);
  let remaining = days - 1;
  let idx = toDayIndex(cur);
  while (remaining > 0) {
    idx++;
    const date = fromDayIndex(idx);
    if (isWorkingDay(date, calendar)) remaining--;
  }
  return fromDayIndex(idx);
}

export function subtractWorkingDays(
  finish: Date,
  days: number,
  calendar: WorkCalendar = DEFAULT_CALENDAR
): Date {
  if (days <= 0) return startOfDay(finish);
  let cur = startOfDay(finish);
  if (!isWorkingDay(cur, calendar)) {
    let idx = toDayIndex(cur);
    while (idx > 0 && !isWorkingDay(fromDayIndex(idx), calendar)) idx--;
    cur = fromDayIndex(idx);
  }
  let remaining = days - 1;
  let idx = toDayIndex(cur);
  while (remaining > 0) {
    idx--;
    if (idx < 0) throw new Error("subtractWorkingDays underflow");
    if (isWorkingDay(fromDayIndex(idx), calendar)) remaining--;
  }
  return fromDayIndex(idx);
}

/** Working days from `from` to `to` inclusive (both must be working days for positive span). */
export function workingDaysBetween(
  from: Date,
  to: Date,
  calendar: WorkCalendar = DEFAULT_CALENDAR
): number {
  const a = toDayIndex(from);
  const b = toDayIndex(to);
  if (b < a) return -workingDaysBetween(to, from, calendar);
  let count = 0;
  for (let i = a; i <= b; i++) {
    if (isWorkingDay(fromDayIndex(i), calendar)) count++;
  }
  return count;
}

export function defaultScheduleStart(from?: Date): Date {
  const base = from ? startOfDay(from) : startOfDay(new Date());
  return isWorkingDay(base) ? base : nextWorkingDay(base);
}
