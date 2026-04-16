/**
 * computeFollowupDates -- Tests
 * Requirement: DSCH-03 (post-discharge follow-up schedule)
 * Source: HEARTLAND Protocol v3.3 Module 4 -- Discharge Bundle & Post-Discharge Follow-Up
 *
 * Tests for the pure function that computes the 5-row follow-up
 * schedule (48h call, day-7 visit, week 2/3/4 calls) based on
 * implementation tier and discharge date.
 */

import { computeFollowupDates } from '@/lib/discharge/engine';
import { BUNDLE_COMPONENTS, TASK_SHIFTING_ROWS, TEACH_BACK_DOMAINS } from '@/lib/discharge/constants';
import { describe, it, expect } from 'vitest';

const DISCHARGE_DATE = new Date('2026-01-01T12:00:00Z');

describe('computeFollowupDates', () => {
  it('returns 5 followup rows for tier 1', () => {
    const result = computeFollowupDates(DISCHARGE_DATE, 1);
    expect(result).toHaveLength(5);
  });

  it('call_48h due_at is discharged_at + 48 hours', () => {
    const result = computeFollowupDates(DISCHARGE_DATE, 1);
    const call48h = result.find((r) => r.type === 'call_48h');
    expect(call48h).toBeDefined();
    // 2026-01-01T12:00:00Z + 48h = 2026-01-03T12:00:00Z
    expect(call48h!.due_at.toISOString()).toBe('2026-01-03T12:00:00.000Z');
  });

  it('visit_day7 due_at is discharged_at + 7 days', () => {
    const result = computeFollowupDates(DISCHARGE_DATE, 1);
    const visitDay7 = result.find((r) => r.type === 'visit_day7');
    expect(visitDay7).toBeDefined();
    // 2026-01-01T12:00:00Z + 7 days = 2026-01-08T12:00:00Z
    expect(visitDay7!.due_at.toISOString()).toBe('2026-01-08T12:00:00.000Z');
  });

  it('call_week2 due_at is discharged_at + 14 days', () => {
    const result = computeFollowupDates(DISCHARGE_DATE, 1);
    const week2 = result.find((r) => r.type === 'call_week2');
    expect(week2).toBeDefined();
    // 2026-01-01T12:00:00Z + 14 days = 2026-01-15T12:00:00Z
    expect(week2!.due_at.toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('week 2/3/4 rows present for tier 1 with tier1_mode "As resources allow"', () => {
    const result = computeFollowupDates(DISCHARGE_DATE, 1);
    const weekRows = result.filter((r) =>
      ['call_week2', 'call_week3', 'call_week4'].includes(r.type)
    );
    expect(weekRows).toHaveLength(3);
    for (const row of weekRows) {
      expect(row.tier1_mode).toBe('As resources allow');
    }
  });

  it('tier 2/3 week 2/3/4 rows have tier23_mode "Structured protocol"', () => {
    const result = computeFollowupDates(DISCHARGE_DATE, 2);
    const weekRows = result.filter((r) =>
      ['call_week2', 'call_week3', 'call_week4'].includes(r.type)
    );
    expect(weekRows).toHaveLength(3);
    for (const row of weekRows) {
      expect(row.tier23_mode).toBe('Structured protocol');
    }
  });
});

describe('BUNDLE_COMPONENTS', () => {
  it('has exactly 4 items', () => {
    expect(BUNDLE_COMPONENTS).toHaveLength(4);
  });

  it('contains correct ids', () => {
    const ids = BUNDLE_COMPONENTS.map((c) => c.id);
    expect(ids).toEqual([
      'case_management',
      'teach_back',
      'med_reconciliation',
      'follow_up_scheduled',
    ]);
  });
});

describe('TASK_SHIFTING_ROWS', () => {
  it('has exactly 8 items', () => {
    expect(TASK_SHIFTING_ROWS).toHaveLength(8);
  });

  it('all rows have non-empty optimal, alternatives, no_chw', () => {
    for (const row of TASK_SHIFTING_ROWS) {
      expect(row.optimal.length).toBeGreaterThan(0);
      expect(row.alternatives.length).toBeGreaterThan(0);
      expect(row.no_chw.length).toBeGreaterThan(0);
    }
  });
});

describe('TEACH_BACK_DOMAINS', () => {
  it('has 3 items for Tier 1 (tier === "all")', () => {
    const tier1 = TEACH_BACK_DOMAINS.filter((d) => d.tier === 'all');
    expect(tier1).toHaveLength(3);
  });

  it('has 8 total items for Tier 2/3', () => {
    expect(TEACH_BACK_DOMAINS).toHaveLength(8);
  });
});
