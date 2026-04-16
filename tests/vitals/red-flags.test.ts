import { describe, it, expect } from 'vitest';
import { evaluateRedFlags } from '@/lib/vitals/red-flags';
import { subDays } from 'date-fns';

// ==========================================================================
// VITL-05: Red Flag Detection Engine -- evaluateRedFlags pure function
// HEARTLAND Protocol v3.3 Module 5, Section 5.2 Red Flag Alert Criteria
//
// Thresholds:
//   1. Weight gain >= 3 lbs in 2 days (severity: warning)
//   2. Weight gain >= 5 lbs in 7 days (severity: critical)
//   3. SBP < 90 mmHg with symptoms (severity: critical)
//   4. SpO2 < 92% (severity: critical)
//   5. Severe dyspnea at rest (severity 3) (severity: critical)
// ==========================================================================

const NO_SYMPTOMS = { dyspnea: 0 as const, edema: 0 as const, orthopnea: false, fatigue: 0 as const };

/** Helper: create a recent history entry N days ago with given weight */
function historyEntry(daysAgo: number, weight_lbs: number) {
  return {
    weight_lbs,
    recorded_at: subDays(new Date(), daysAgo).toISOString(),
  };
}

describe('evaluateRedFlags', () => {
  // --- Weight gain >= 3 lbs in 2 days (warning) ---
  describe('weight gain >= 3 lbs in 2 days', () => {
    it('triggers when current weight is 3+ lbs above minimum weight within 2-day window', () => {
      const current = { weight_lbs: 168, sbp: 120, spo2: 97 };
      const history = [historyEntry(1, 165)]; // 3 lbs gain in 1 day
      const flags = evaluateRedFlags(current, history, NO_SYMPTOMS);
      expect(flags).toContainEqual(
        expect.objectContaining({ id: 'weight_gain_3lb_2d', severity: 'warning' })
      );
    });

    it('does not trigger at 2.9 lbs gain (boundary)', () => {
      const current = { weight_lbs: 167.9, sbp: 120, spo2: 97 };
      const history = [historyEntry(1, 165)]; // 2.9 lbs gain
      const flags = evaluateRedFlags(current, history, NO_SYMPTOMS);
      expect(flags.find((f) => f.id === 'weight_gain_3lb_2d')).toBeUndefined();
    });

    it('skips weight-trend check when recentHistory is empty (first entry)', () => {
      const current = { weight_lbs: 200, sbp: 120, spo2: 97 };
      const flags = evaluateRedFlags(current, [], NO_SYMPTOMS);
      expect(flags.find((f) => f.id === 'weight_gain_3lb_2d')).toBeUndefined();
      expect(flags.find((f) => f.id === 'weight_gain_5lb_7d')).toBeUndefined();
    });
  });

  // --- Weight gain >= 5 lbs in 7 days (critical) ---
  describe('weight gain >= 5 lbs in 7 days', () => {
    it('triggers when current weight is 5+ lbs above minimum weight within 7-day window', () => {
      const current = { weight_lbs: 175, sbp: 120, spo2: 97 };
      const history = [historyEntry(5, 170)]; // 5 lbs gain in 5 days
      const flags = evaluateRedFlags(current, history, NO_SYMPTOMS);
      expect(flags).toContainEqual(
        expect.objectContaining({ id: 'weight_gain_5lb_7d', severity: 'critical' })
      );
    });

    it('does not trigger at 4.9 lbs gain (boundary)', () => {
      const current = { weight_lbs: 174.9, sbp: 120, spo2: 97 };
      const history = [historyEntry(5, 170)]; // 4.9 lbs gain
      const flags = evaluateRedFlags(current, history, NO_SYMPTOMS);
      expect(flags.find((f) => f.id === 'weight_gain_5lb_7d')).toBeUndefined();
    });
  });

  // --- SBP < 90 with symptoms (critical) ---
  describe('SBP < 90 with symptoms', () => {
    it('triggers when SBP is 89 and dyspnea > 0', () => {
      const current = { weight_lbs: 165, sbp: 89, spo2: 97 };
      const symptoms = { ...NO_SYMPTOMS, dyspnea: 1 as const };
      const flags = evaluateRedFlags(current, [], symptoms);
      expect(flags).toContainEqual(
        expect.objectContaining({ id: 'sbp_low_symptomatic', severity: 'critical' })
      );
    });

    it('triggers when SBP is 85 and fatigue severity > 1', () => {
      const current = { weight_lbs: 165, sbp: 85, spo2: 97 };
      const symptoms = { ...NO_SYMPTOMS, fatigue: 2 as const };
      const flags = evaluateRedFlags(current, [], symptoms);
      expect(flags).toContainEqual(
        expect.objectContaining({ id: 'sbp_low_symptomatic', severity: 'critical' })
      );
    });

    it('does not trigger when SBP is 89 but all symptoms are 0/none', () => {
      const current = { weight_lbs: 165, sbp: 89, spo2: 97 };
      const flags = evaluateRedFlags(current, [], NO_SYMPTOMS);
      expect(flags.find((f) => f.id === 'sbp_low_symptomatic')).toBeUndefined();
    });

    it('does not trigger when SBP is 90 (boundary) even with symptoms', () => {
      const current = { weight_lbs: 165, sbp: 90, spo2: 97 };
      const symptoms = { ...NO_SYMPTOMS, dyspnea: 2 as const };
      const flags = evaluateRedFlags(current, [], symptoms);
      expect(flags.find((f) => f.id === 'sbp_low_symptomatic')).toBeUndefined();
    });
  });

  // --- SpO2 < 92% (critical) ---
  describe('SpO2 < 92%', () => {
    it('triggers when SpO2 is 91', () => {
      const current = { weight_lbs: 165, sbp: 120, spo2: 91 };
      const flags = evaluateRedFlags(current, [], NO_SYMPTOMS);
      expect(flags).toContainEqual(
        expect.objectContaining({ id: 'spo2_low', severity: 'critical' })
      );
    });

    it('does not trigger when SpO2 is 92 (boundary)', () => {
      const current = { weight_lbs: 165, sbp: 120, spo2: 92 };
      const flags = evaluateRedFlags(current, [], NO_SYMPTOMS);
      expect(flags.find((f) => f.id === 'spo2_low')).toBeUndefined();
    });

    it('skips check when SpO2 is null (not provided)', () => {
      const current = { weight_lbs: 165, sbp: 120, spo2: null };
      const flags = evaluateRedFlags(current, [], NO_SYMPTOMS);
      expect(flags.find((f) => f.id === 'spo2_low')).toBeUndefined();
    });
  });

  // --- Severe dyspnea at rest (critical) ---
  describe('severe dyspnea at rest', () => {
    it('triggers when dyspnea severity is 3 (severe)', () => {
      const current = { weight_lbs: 165, sbp: 120, spo2: 97 };
      const symptoms = { ...NO_SYMPTOMS, dyspnea: 3 as const };
      const flags = evaluateRedFlags(current, [], symptoms);
      expect(flags).toContainEqual(
        expect.objectContaining({ id: 'dyspnea_rest', severity: 'critical' })
      );
    });

    it('does not trigger when dyspnea severity is 2 (moderate)', () => {
      const current = { weight_lbs: 165, sbp: 120, spo2: 97 };
      const symptoms = { ...NO_SYMPTOMS, dyspnea: 2 as const };
      const flags = evaluateRedFlags(current, [], symptoms);
      expect(flags.find((f) => f.id === 'dyspnea_rest')).toBeUndefined();
    });
  });

  // --- Combined scenarios ---
  describe('combined scenarios', () => {
    it('returns multiple flags when multiple criteria triggered simultaneously', () => {
      const current = { weight_lbs: 175, sbp: 85, spo2: 90 };
      const history = [historyEntry(1, 170)]; // 5 lbs gain in 1 day
      const symptoms = { dyspnea: 3 as const, edema: 2 as const, orthopnea: true, fatigue: 2 as const };
      const flags = evaluateRedFlags(current, history, symptoms);
      // Should trigger: weight 3lb/2d, weight 5lb/7d, SBP <90 with symptoms, SpO2 <92, dyspnea severe
      expect(flags.length).toBeGreaterThanOrEqual(4);
      const ids = flags.map((f) => f.id);
      expect(ids).toContain('weight_gain_3lb_2d');
      expect(ids).toContain('weight_gain_5lb_7d');
      expect(ids).toContain('sbp_low_symptomatic');
      expect(ids).toContain('spo2_low');
      expect(ids).toContain('dyspnea_rest');
    });

    it('returns empty array when no criteria are met', () => {
      const current = { weight_lbs: 165, sbp: 120, spo2: 97 };
      const history = [historyEntry(1, 165)]; // no weight change
      const flags = evaluateRedFlags(current, history, NO_SYMPTOMS);
      expect(flags).toEqual([]);
    });
  });

  // --- Unit conversion edge case ---
  describe('unit conversion edge case', () => {
    it('correctly detects 3-lb gain when patient enters kg (70.0 kg -> 71.5 kg = ~3.3 lbs gain)', () => {
      // The Server Action converts kg to lbs before calling evaluateRedFlags
      // 70.0 kg = 154.3 lbs, 71.5 kg = 157.6 lbs, delta = 3.3 lbs >= 3 threshold
      const current = { weight_lbs: 157.6, sbp: 120, spo2: 97 };
      const history = [historyEntry(1, 154.3)];
      const flags = evaluateRedFlags(current, history, NO_SYMPTOMS);
      expect(flags).toContainEqual(
        expect.objectContaining({ id: 'weight_gain_3lb_2d', severity: 'warning' })
      );
    });
  });
});
