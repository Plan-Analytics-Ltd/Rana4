export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function diffDaysFromDates(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  const d = (b.getTime() - a.getTime()) / MS_PER_DAY;
  if (!Number.isFinite(d)) return null;
  return Math.max(0, Math.round(d));
}

export function diffDaysFromIso(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const start = new Date(a);
  const finish = new Date(b);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(finish.getTime())) return null;
  const d = (finish.getTime() - start.getTime()) / MS_PER_DAY;
  if (!Number.isFinite(d)) return null;
  return Math.max(0, Math.round(d));
}

export function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
