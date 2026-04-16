/**
 * Alert Evaluation Engine -- Tests
 * Requirements: DASH-04 (alert badges), DASH-05 (alert inbox)
 * Source: HEARTLAND Protocol v3.3 Module 5 Section 5.2
 *
 * Red flag thresholds:
 *   - Weight gain >= 3 lbs in 2 days
 *   - Weight gain >= 5 lbs in 1 week
 *   - SBP < 90 mmHg
 *   - SpO2 < 92% at rest
 *   - Red flag symptom (chest pain, syncope)
 *   - Severe dyspnea at rest (dyspnea = 3)
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateAlertFlags,
  determineSeverity,
  shouldDeduplicate,
} from '@/lib/dashboard/alert-engine';
import type { AlertRow } from '@/lib/dashboard/types';

// ==========================================================================
// evaluateAlertFlags
// ==========================================================================
describe('evaluateAlertFlags', () => {
  const baseVitals = {
    weight_lbs: 180 as number | null,
    sbp: 120 as number | null,
    dbp: 80 as number | null,
    heart_rate: 72 as number | null,
    spo2: 97 as number | null,
    recorded_at: '2026-03-26T10:00:00Z',
  };

  const noSymptoms = {
    dyspnea: 0 as 0 | 1 | 2 | 3,
    edema: 0 as 0 | 1 | 2 | 3,
    orthopnea: false,
    fatigue: 0 as 0 | 1 | 2 | 3,
    red_flag: false,
  };

  it('returns empty array when all vitals are normal', () => {
    const flags = evaluateAlertFlags(baseVitals, [], null);
    expect(flags).toEqual([]);
  });

  // -- SBP < 90 --
  it('flags sbp_low when SBP < 90', () => {
    const flags = evaluateAlertFlags({ ...baseVitals, sbp: 85 }, [], null);
    expect(flags).toContain('sbp_low');
  });

  it('does not flag sbp_low when SBP = 90 (boundary)', () => {
    const flags = evaluateAlertFlags({ ...baseVitals, sbp: 90 }, [], null);
    expect(flags).not.toContain('sbp_low');
  });

  // -- SpO2 < 92% --
  it('flags spo2_low when SpO2 < 92', () => {
    const flags = evaluateAlertFlags({ ...baseVitals, spo2: 89 }, [], null);
    expect(flags).toContain('spo2_low');
  });

  it('does not flag spo2_low when SpO2 = 92 (boundary)', () => {
    const flags = evaluateAlertFlags({ ...baseVitals, spo2: 92 }, [], null);
    expect(flags).not.toContain('spo2_low');
  });

  // -- Weight gain >= 3 lbs in 2 days --
  it('flags weight_gain_3lb_2d when weight gain >= 3 lbs in 2 days', () => {
    const recentVitals = [
      { weight_lbs: 177, recorded_at: '2026-03-24T10:00:00Z' },
    ];
    const flags = evaluateAlertFlags(baseVitals, recentVitals, null);
    expect(flags).toContain('weight_gain_3lb_2d');
  });

  it('does not flag weight_gain_3lb_2d when gain is exactly 2.9 lbs', () => {
    const recentVitals = [
      { weight_lbs: 177.1, recorded_at: '2026-03-24T10:00:00Z' },
    ];
    const flags = evaluateAlertFlags(baseVitals, recentVitals, null);
    expect(flags).not.toContain('weight_gain_3lb_2d');
  });

  // -- Weight gain >= 5 lbs in 7 days --
  it('flags weight_gain_5lb_7d when weight gain >= 5 lbs in 7 days', () => {
    const recentVitals = [
      { weight_lbs: 175, recorded_at: '2026-03-19T10:00:00Z' },
    ];
    const flags = evaluateAlertFlags(baseVitals, recentVitals, null);
    expect(flags).toContain('weight_gain_5lb_7d');
  });

  it('does not flag weight_gain_5lb_7d when gain is 4.9 lbs over 7 days', () => {
    const recentVitals = [
      { weight_lbs: 175.1, recorded_at: '2026-03-19T10:00:00Z' },
    ];
    const flags = evaluateAlertFlags(baseVitals, recentVitals, null);
    expect(flags).not.toContain('weight_gain_5lb_7d');
  });

  // -- Symptom red flag --
  it('flags symptom_red_flag when red_flag is true', () => {
    const flags = evaluateAlertFlags(baseVitals, [], {
      ...noSymptoms,
      red_flag: true,
    });
    expect(flags).toContain('symptom_red_flag');
  });

  // -- Severe dyspnea --
  it('flags dyspnea_severe when dyspnea = 3', () => {
    const flags = evaluateAlertFlags(baseVitals, [], {
      ...noSymptoms,
      dyspnea: 3,
    });
    expect(flags).toContain('dyspnea_severe');
  });

  it('does not flag dyspnea_severe when dyspnea = 2', () => {
    const flags = evaluateAlertFlags(baseVitals, [], {
      ...noSymptoms,
      dyspnea: 2,
    });
    expect(flags).not.toContain('dyspnea_severe');
  });

  // -- Null handling --
  it('skips weight checks when weight_lbs is null', () => {
    const flags = evaluateAlertFlags(
      { ...baseVitals, weight_lbs: null },
      [{ weight_lbs: 175, recorded_at: '2026-03-24T10:00:00Z' }],
      null
    );
    expect(flags).not.toContain('weight_gain_3lb_2d');
    expect(flags).not.toContain('weight_gain_5lb_7d');
  });

  it('skips spo2 check when spo2 is null', () => {
    const flags = evaluateAlertFlags(
      { ...baseVitals, spo2: null },
      [],
      null
    );
    expect(flags).not.toContain('spo2_low');
  });

  it('skips sbp check when sbp is null', () => {
    const flags = evaluateAlertFlags(
      { ...baseVitals, sbp: null },
      [],
      null
    );
    expect(flags).not.toContain('sbp_low');
  });

  // -- Multiple flags simultaneously --
  it('returns multiple flags when multiple thresholds breached', () => {
    const recentVitals = [
      { weight_lbs: 177, recorded_at: '2026-03-24T10:00:00Z' },
    ];
    const flags = evaluateAlertFlags(
      { ...baseVitals, sbp: 85, spo2: 88 },
      recentVitals,
      { ...noSymptoms, red_flag: true }
    );
    expect(flags).toContain('sbp_low');
    expect(flags).toContain('spo2_low');
    expect(flags).toContain('weight_gain_3lb_2d');
    expect(flags).toContain('symptom_red_flag');
    expect(flags.length).toBeGreaterThanOrEqual(4);
  });
});

// ==========================================================================
// determineSeverity
// ==========================================================================
describe('determineSeverity', () => {
  it('returns critical when sbp_low is present', () => {
    expect(determineSeverity(['sbp_low'])).toBe('critical');
  });

  it('returns critical when spo2_low is present', () => {
    expect(determineSeverity(['spo2_low'])).toBe('critical');
  });

  it('returns critical when weight_gain_3lb_2d is present', () => {
    expect(determineSeverity(['weight_gain_3lb_2d'])).toBe('critical');
  });

  it('returns critical when symptom_red_flag is present', () => {
    expect(determineSeverity(['symptom_red_flag'])).toBe('critical');
  });

  it('returns warning for dyspnea_severe alone', () => {
    expect(determineSeverity(['dyspnea_severe'])).toBe('warning');
  });

  it('returns warning for weight_gain_5lb_7d alone', () => {
    expect(determineSeverity(['weight_gain_5lb_7d'])).toBe('warning');
  });

  it('returns critical when mix of critical and warning flags', () => {
    expect(determineSeverity(['dyspnea_severe', 'sbp_low'])).toBe('critical');
  });
});

// ==========================================================================
// shouldDeduplicate
// ==========================================================================
describe('shouldDeduplicate', () => {
  const now = new Date('2026-03-26T12:00:00Z');

  const recentAlert = {
    flags: ['sbp_low', 'spo2_low'] as string[],
    status: 'open' as const,
    created_at: '2026-03-26T10:00:00Z', // 2 hours ago
  };

  const oldAlert = {
    flags: ['sbp_low'] as string[],
    status: 'open' as const,
    created_at: '2026-03-25T00:00:00Z', // 36 hours ago
  };

  const resolvedAlert = {
    flags: ['sbp_low'] as string[],
    status: 'resolved' as const,
    created_at: '2026-03-26T10:00:00Z',
  };

  it('returns true when same flag exists in open alert within window', () => {
    expect(shouldDeduplicate('sbp_low', [recentAlert], 24, now)).toBe(true);
  });

  it('returns false when flag does not exist in any open alert', () => {
    expect(
      shouldDeduplicate('weight_gain_3lb_2d', [recentAlert], 24, now)
    ).toBe(false);
  });

  it('returns false when alert is outside time window', () => {
    expect(shouldDeduplicate('sbp_low', [oldAlert], 24, now)).toBe(false);
  });

  it('returns false when alert is resolved', () => {
    expect(shouldDeduplicate('sbp_low', [resolvedAlert], 24, now)).toBe(
      false
    );
  });

  it('returns false when no existing alerts', () => {
    expect(shouldDeduplicate('sbp_low', [], 24, now)).toBe(false);
  });
});
