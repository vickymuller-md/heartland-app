// EFFI-04: Lab staleness warning in titration checklist
// Tests for isLabStale pure function
// Implementation in: lib/dashboard/worklist-queries.ts

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isLabStale } from '@/lib/dashboard/worklist-queries';
import { subDays } from 'date-fns';

describe('isLabStale (EFFI-04)', () => {
  afterEach(() => vi.useRealTimers());
  it('returns false when collected_at is 13 days ago', () => {
    const thirteenDaysAgo = subDays(new Date(), 13).toISOString();
    expect(isLabStale(thirteenDaysAgo)).toBe(false);
  });

  it('returns false when collected_at is exactly 14 days ago (boundary — not yet stale)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    const fourteenDaysAgo = subDays(new Date(), 14).toISOString();
    expect(isLabStale(fourteenDaysAgo)).toBe(false);
  });

  it('returns true when collected_at is 15 days ago', () => {
    const fifteenDaysAgo = subDays(new Date(), 15).toISOString();
    expect(isLabStale(fifteenDaysAgo)).toBe(true);
  });

  it('returns false when collected_at is null (no labs — no staleness warning shown)', () => {
    expect(isLabStale(null)).toBe(false);
  });
  it('preserves the legacy boolean only; missing data is classified separately in the worklist', () => {
    expect(isLabStale('invalid')).toBe(false);
  });
});
