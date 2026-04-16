// EFFI-03: Titration worklist — patients due for titration this week
// Tests for isDueTitration pure function
// Implementation in: lib/dashboard/worklist-queries.ts

import { describe, it, expect } from 'vitest';
import { isDueTitration } from '@/lib/dashboard/worklist-queries';
import { subDays } from 'date-fns';

describe('isDueTitration (EFFI-03)', () => {
  it('returns true when lastTitrationAt is null (never titrated)', () => {
    expect(isDueTitration(null)).toBe(true);
  });

  it('returns false when lastTitrationAt is 6 days ago', () => {
    const sixDaysAgo = subDays(new Date(), 6).toISOString();
    expect(isDueTitration(sixDaysAgo)).toBe(false);
  });

  it('returns true when lastTitrationAt is exactly 7 days ago', () => {
    const sevenDaysAgo = subDays(new Date(), 7).toISOString();
    expect(isDueTitration(sevenDaysAgo)).toBe(true);
  });

  it('returns true when lastTitrationAt is 14 days ago', () => {
    const fourteenDaysAgo = subDays(new Date(), 14).toISOString();
    expect(isDueTitration(fourteenDaysAgo)).toBe(true);
  });
});
