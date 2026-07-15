import { describe, expect, it } from 'vitest';
import { getDateKeyInTimeZone, getZonedDayBounds } from '@/lib/timezone';

describe('organization timezone boundaries', () => {
  it('uses a 23-hour local day across spring DST', () => {
    const bounds = getZonedDayBounds(new Date('2026-03-08T12:00:00Z'), 'America/New_York');
    expect(bounds.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(bounds.endExclusive.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('uses a 25-hour local day across fall DST', () => {
    const bounds = getZonedDayBounds(new Date('2026-11-01T12:00:00Z'), 'America/New_York');
    expect(bounds.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(bounds.endExclusive.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('does not roll an Eastern evening into the next UTC date', () => {
    expect(getDateKeyInTimeZone(new Date('2026-07-15T01:00:00Z'), 'America/New_York')).toBe('2026-07-14');
  });
});
