import { describe, it, expect } from 'vitest';
import { subDays } from 'date-fns';
import { evaluatePlausibility, evaluateRedFlags } from '@/lib/vitals/red-flags';

// Plausibility layer sits inside Zod bounds: these values ARE accepted by
// the schema but are suspicious enough to deserve a "verify measurement"
// warning. Tests exercise both the warning output and the scale-malfunction
// guard that suppresses false red flags when weight deltas are implausible.

const NO_SYMPTOMS = { dyspnea: 0 as const, edema: 0 as const, orthopnea: false, fatigue: 0 as const };

function history(daysAgo: number, weight_lbs: number) {
  return { weight_lbs, recorded_at: subDays(new Date(), daysAgo).toISOString() };
}

describe('evaluatePlausibility', () => {
  it('returns no warnings for typical adult vitals', () => {
    const warnings = evaluatePlausibility(
      { weight_lbs: 180, sbp: 120, dbp: 80, heart_rate: 72, spo2: 97 },
      [history(1, 179)]
    );
    expect(warnings).toEqual([]);
  });

  it('flags implausibly high heart rate (185 bpm)', () => {
    const warnings = evaluatePlausibility(
      { weight_lbs: 180, sbp: 120, dbp: 80, heart_rate: 185, spo2: 97 },
      []
    );
    expect(warnings.some((w) => w.field === 'heart_rate')).toBe(true);
  });

  it('flags implausibly high SBP (215 mmHg)', () => {
    const warnings = evaluatePlausibility(
      { weight_lbs: 180, sbp: 215, dbp: 95, heart_rate: 80, spo2: 97 },
      []
    );
    expect(warnings.some((w) => w.field === 'sbp')).toBe(true);
  });

  it('flags very low weight (60 lbs — likely a scale calibration issue)', () => {
    const warnings = evaluatePlausibility(
      { weight_lbs: 60, sbp: 120, dbp: 80, heart_rate: 72, spo2: 97 },
      []
    );
    expect(warnings.some((w) => w.field === 'weight_lbs')).toBe(true);
  });

  it('ignores SpO2 plausibility when value is null (not provided)', () => {
    const warnings = evaluatePlausibility(
      { weight_lbs: 180, sbp: 120, dbp: 80, heart_rate: 72, spo2: null },
      []
    );
    expect(warnings.some((w) => w.field === 'spo2')).toBe(false);
  });

  it('flags weight delta >20% as likely scale malfunction', () => {
    const warnings = evaluatePlausibility(
      { weight_lbs: 250, sbp: 120, dbp: 80, heart_rate: 72, spo2: 97 },
      [history(1, 180)] // 70 lb jump = 38.9%
    );
    expect(warnings.some((w) => w.field === 'weight_lbs' && w.message.includes('20%'))).toBe(true);
  });

  it('does not flag a small legitimate weight change', () => {
    const warnings = evaluatePlausibility(
      { weight_lbs: 183, sbp: 120, dbp: 80, heart_rate: 72, spo2: 97 },
      [history(1, 180)] // 3 lb change = 1.7%
    );
    expect(warnings).toEqual([]);
  });
});

describe('evaluateRedFlags scale-malfunction guard', () => {
  it('suppresses weight red flags when current reading is >20% off the last one', () => {
    // Without the guard, a 40 lb jump would fire both weight_gain_3lb_2d
    // and weight_gain_5lb_7d. The guard treats this as a scale error and
    // withholds the red flag; a plausibility warning is surfaced instead.
    const current = { weight_lbs: 220, sbp: 120, spo2: 97 };
    const recent = [history(1, 180)];
    const flags = evaluateRedFlags(current, recent, NO_SYMPTOMS);
    expect(flags.find((f) => f.id === 'weight_gain_3lb_2d')).toBeUndefined();
    expect(flags.find((f) => f.id === 'weight_gain_5lb_7d')).toBeUndefined();
  });

  it('still fires legitimate weight red flags when delta is within 20% range', () => {
    // 5 lb gain in 1 day on a 170 lb baseline = 2.9% (well inside the
    // plausibility envelope). Expect both weight red flags to fire.
    const current = { weight_lbs: 175, sbp: 120, spo2: 97 };
    const recent = [history(1, 170)];
    const flags = evaluateRedFlags(current, recent, NO_SYMPTOMS);
    expect(flags.map((f) => f.id)).toEqual(
      expect.arrayContaining(['weight_gain_3lb_2d', 'weight_gain_5lb_7d'])
    );
  });
});
