import type { ReportDateRange } from './types';

const DAY_MS = 86_400_000;
/** Date-only controls select whole UTC calendar days, including the final day. */
export function reportDateBounds(range: ReportDateRange) {
  const parseDay = (value: string) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime())
      || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid report date range');
    return date.getTime();
  };
  const from = parseDay(range.from); const to = parseDay(range.to);
  if (from > to || to - from > 366 * DAY_MS) throw new Error('Invalid report date range');
  return { fromInclusive: new Date(from).toISOString(), toExclusive: new Date(to + DAY_MS).toISOString() };
}

export function lastUtcDays(count: number, now = new Date()): ReportDateRange {
  const to = now.toISOString().slice(0, 10);
  const first = new Date(to + 'T00:00:00Z');
  first.setUTCDate(first.getUTCDate() - count + 1);
  return { from: first.toISOString().slice(0, 10), to };
}
