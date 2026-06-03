/** Timeline layout for Gantt — positioning only; dates come from CPM engine. */

export type TimelineZoom = "days" | "weeks" | "months";

/** Shared row height for schedule grid + Gantt (keep in sync). */
export const SCHEDULE_ROW_HEIGHT = 32;
export const SCHEDULE_GRID_HEADER_HEIGHT = 36;

export type TimelineConfig = {
  zoom: TimelineZoom;
  rangeStart: Date;
  rangeEnd: Date;
  pxPerDay: number;
  headerHeight: number;
  rowHeight: number;
};

const MS_PER_DAY = 86_400_000;

export function parseScheduleDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

export function toDayIndex(d: Date): number {
  return Math.floor(d.getTime() / MS_PER_DAY);
}

export function fromDayIndex(i: number): Date {
  return new Date(i * MS_PER_DAY);
}

export function daysBetween(start: Date, end: Date): number {
  return toDayIndex(end) - toDayIndex(start);
}

export function addCalendarDays(d: Date, days: number): Date {
  return fromDayIndex(toDayIndex(d) + days);
}

export function defaultPxPerDay(zoom: TimelineZoom): number {
  switch (zoom) {
    case "days":
      return 18;
    case "weeks":
      return 5;
    case "months":
      return 2;
  }
}

/** Inclusive span in calendar days for bar width (ES–EF from engine). */
export function activitySpanDays(earlyStart: Date, earlyFinish: Date): number {
  return Math.max(1, daysBetween(earlyStart, earlyFinish) + 1);
}

export function computeDateRange(
  dates: Array<{ start: Date | null; finish: Date | null }>,
  paddingDays = 14
): { rangeStart: Date; rangeEnd: Date } {
  let min = toDayIndex(new Date());
  let max = min;
  let any = false;
  for (const { start, finish } of dates) {
    if (start) {
      const s = toDayIndex(start);
      min = any ? Math.min(min, s) : s;
      max = any ? Math.max(max, s) : s;
      any = true;
    }
    if (finish) {
      const f = toDayIndex(finish);
      min = any ? Math.min(min, f) : f;
      max = any ? Math.max(max, f) : f;
      any = true;
    }
  }
  if (!any) {
    const today = startOfUtcToday();
    return {
      rangeStart: addCalendarDays(today, -paddingDays),
      rangeEnd: addCalendarDays(today, paddingDays * 2),
    };
  }
  return {
    rangeStart: fromDayIndex(min - paddingDays),
    rangeEnd: fromDayIndex(max + paddingDays),
  };
}

export function startOfUtcToday(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

export function buildTimelineConfig(
  rangeStart: Date,
  rangeEnd: Date,
  zoom: TimelineZoom,
  rowHeight = SCHEDULE_ROW_HEIGHT
): TimelineConfig {
  return {
    zoom,
    rangeStart,
    rangeEnd,
    pxPerDay: defaultPxPerDay(zoom),
    headerHeight: zoom === "days" ? 40 : 34,
    rowHeight,
  };
}

export function timelineWidthPx(config: TimelineConfig): number {
  const days = daysBetween(config.rangeStart, config.rangeEnd) + 1;
  return Math.max(days * config.pxPerDay, 400);
}

export function dateToX(date: Date, config: TimelineConfig): number {
  return daysBetween(config.rangeStart, date) * config.pxPerDay;
}

export type BarLayout = {
  left: number;
  width: number;
  isMilestone: boolean;
};

export function layoutActivityBar(
  earlyStart: Date | null,
  earlyFinish: Date | null,
  durationDays: number,
  config: TimelineConfig
): BarLayout | null {
  if (!earlyStart || !earlyFinish) return null;
  const milestone = durationDays <= 0;
  const left = dateToX(earlyStart, config);
  const span = milestone ? 1 : activitySpanDays(earlyStart, earlyFinish);
  const width = Math.max(milestone ? 10 : config.pxPerDay * 0.6, span * config.pxPerDay - 2);
  return { left, width, isMilestone: milestone };
}

export type TimelineTick = {
  label: string;
  x: number;
  width: number;
};

export function generateTimelineTicks(config: TimelineConfig): TimelineTick[] {
  const ticks: TimelineTick[] = [];
  const totalDays = daysBetween(config.rangeStart, config.rangeEnd) + 1;
  const { zoom, pxPerDay, rangeStart } = config;

  if (zoom === "days") {
    const limit = Math.min(totalDays, 500);
    for (let i = 0; i < limit; i++) {
      const d = addCalendarDays(rangeStart, i);
      const label =
        i === 0 || d.getUTCDay() === 1
          ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
          : String(d.getUTCDate());
      ticks.push({ label, x: i * pxPerDay, width: pxPerDay });
    }
    return ticks;
  }

  if (zoom === "weeks") {
    for (let i = 0; i < totalDays; i += 7) {
      const d = addCalendarDays(rangeStart, i);
      ticks.push({
        label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
        x: i * pxPerDay,
        width: 7 * pxPerDay,
      });
    }
    return ticks;
  }

  let cursor = 0;
  let month = rangeStart.getUTCMonth();
  let year = rangeStart.getUTCFullYear();
  while (cursor < totalDays) {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const d = new Date(Date.UTC(year, month, 1));
    const offset = Math.max(0, daysBetween(rangeStart, d));
    const w = daysInMonth * pxPerDay;
    ticks.push({
      label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
      x: offset * pxPerDay,
      width: w,
    });
    cursor = offset + daysInMonth;
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return ticks;
}

export function todayLineX(config: TimelineConfig): number | null {
  const today = startOfUtcToday();
  if (toDayIndex(today) < toDayIndex(config.rangeStart) || toDayIndex(today) > toDayIndex(config.rangeEnd)) {
    return null;
  }
  return dateToX(today, config);
}

/** Viewport slice for virtualized gantt rows. */
export function visibleRowRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalRows: number,
  overscan = 8
): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(totalRows, start + visible);
  return { start, end };
}
