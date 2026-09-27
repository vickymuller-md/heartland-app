import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateCapturedVitals, evaluateCapturedBatchVitals, flagsFromReceipt, IncompleteVitalsHistoryError } from '@/lib/vitals/receipt-evaluation';
import { evaluateRedFlags } from '@/lib/vitals/red-flags';

const clock = '2026-09-23T12:00:00.000Z';
const current = { id: '45000000-0000-4000-8000-000000000001', recorded_at: clock,
  weight_lbs: 180, sbp: 120, spo2: 97 };
const symptoms = { dyspnea: 0, edema: 0, orthopnea: false, fatigue: 0 };
const prior = (days: number, weight: number | null, id = '45000000-0000-4000-8000-000000000002') => ({
  id, recorded_at: new Date(Date.parse(clock) - days * 86_400_000).toISOString(), weight_lbs: weight,
});

describe('frozen batch evaluation recipe', () => {
  it('keeps prior-only scale suppression, unlike individual self-inclusion', () => {
    const data = receipt([prior(1, 120)]);
    expect(evaluateCapturedBatchVitals(data, data.history)).toEqual([]);
    expect(evaluateCapturedVitals(data)).toHaveLength(2);
  });
  it('preserves prepend order instead of sorting backdated prior rows', () => {
    const history = [prior(3, 120), prior(1, 175, '45000000-0000-4000-8000-000000000003')];
    expect(evaluateCapturedBatchVitals(receipt(), history)).toEqual([]);
    expect(evaluateCapturedBatchVitals(receipt(), [...history].reverse())).toHaveLength(2);
  });
  it.each([0, 1, 2, 6.999, 7, 14, -1])('preserves batch boundary at %s days', (days) => {
    vi.useFakeTimers(); vi.setSystemTime('2027-06-01T00:00:00Z');
    const history = [prior(days, 175)];
    expect(evaluateCapturedBatchVitals(receipt(), history)).toEqual(evaluateRedFlags(current,
      history as Array<{weight_lbs:number;recorded_at:string}>, symptoms, new Date(clock)));
  });
  it('accepts1006 rows, rejects overflow and self-inclusion', () => {
    expect(() => evaluateCapturedBatchVitals(receipt([]), Array.from({ length: 1006 }, () => prior(1, 180)))).not.toThrow();
    expect(() => evaluateCapturedBatchVitals(receipt([]), Array.from({ length: 1007 }, () => prior(1, 180)))).toThrow();
    expect(() => evaluateCapturedBatchVitals(receipt([]), [current])).toThrow();
  });
  it('keeps independent critical flags when batch weight history is incomplete', () => {
    const data = receipt([]); data.observation.symptoms.dyspnea = 3;
    try { evaluateCapturedBatchVitals(data, [prior(10, null)]); throw new Error('expected incomplete'); }
    catch (error) {
      expect(error).toBeInstanceOf(IncompleteVitalsHistoryError);
      expect((error as IncompleteVitalsHistoryError).observedFlags.map((flag) => flag.id)).toEqual(['dyspnea_rest']);
    }
  });
});
const receipt = (history = [prior(1, 177)]) => ({ context_version: 1, captured_at: clock,
  observation: { vitals: { ...current }, symptoms: { ...symptoms } }, history });

afterEach(() => vi.useRealTimers());
describe('frozen individual evaluation recipe', () => {
  it('uses captured time even if recovery happens months later', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2027-04-01T12:00:00Z');
    expect(evaluateCapturedVitals(receipt()).map((flag) => flag.id)).toEqual(['weight_gain_3lb_2d']);
  });
  it.each([0, 1, 1.999, 2, 2.001, 6.999, 7, 7.001, 14, -1])('preserves strict cutoff and legacy future handling at %s days', (days) => {
    const data = receipt([prior(days, 175)]);
    const legacyHistory = [current, ...data.history].filter((row) => Date.parse(row.recorded_at) >= Date.parse(clock) - 7 * 86_400_000)
      .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at));
    expect(evaluateCapturedVitals(data)).toEqual(evaluateRedFlags(current,
      legacyHistory as Array<{weight_lbs: number;recorded_at: string}>, symptoms, new Date(clock)));
  });
  it.each([60, 89, 90, 91, 120, 260])('preserves symptom-dependent systolic checks at %s', (sbp) => {
    for (const dyspnea of [0, 1, 2, 3]) for (const fatigue of [0, 1, 2, 3]) {
      const data = receipt([]);
      data.observation.vitals.sbp = sbp;
      data.observation.symptoms = { ...symptoms, dyspnea, fatigue };
      expect(evaluateCapturedVitals(data)).toEqual(evaluateRedFlags(data.observation.vitals,
        [data.observation.vitals], data.observation.symptoms, new Date(clock)));
    }
  });
  it.each([50, 91, 92, 93, 100, null])('preserves saturation handling for %s', (spo2) => {
    const data = { ...receipt([]), observation: { vitals: { ...current, spo2 }, symptoms } };
    expect(evaluateCapturedVitals(data)).toEqual(evaluateRedFlags(data.observation.vitals, [current], symptoms, new Date(clock)));
  });
  it('preserves individual self-inclusion rather than silently changing scale suppression', () => {
    expect(evaluateCapturedVitals(receipt([prior(1, 120)])).map((flag) => flag.id))
      .toEqual(['weight_gain_3lb_2d', 'weight_gain_5lb_7d']);
  });
  it('does not move a backdated reading to the first position', () => {
    const data = receipt([prior(1, 120)]);
    data.observation.vitals.recorded_at = prior(3, 180).recorded_at;
    expect(evaluateCapturedVitals(data)).toEqual([]); // Existing scale guard uses latest historical measurement.
  });
  it('preserves microsecond ordering before applying UUID tie breaks', () => {
    const data = receipt([{ ...prior(0, 100), recorded_at: '2026-09-23T12:00:00.000100Z' }]);
    data.observation.vitals = { ...current, weight_lbs: 200, recorded_at: '2026-09-23T12:00:00.000200Z' };
    expect(evaluateCapturedVitals(data).map((flag) => flag.id)).toEqual(['weight_gain_3lb_2d', 'weight_gain_5lb_7d']);
  });
  it('does not invent a historical zero or hide independent critical flags', () => {
    const data = receipt([prior(1, null)]);
    data.observation.vitals.spo2 = 90;
    try { evaluateCapturedVitals(data); throw new Error('expected incomplete history'); }
    catch (error) {
      expect(error).toBeInstanceOf(IncompleteVitalsHistoryError);
      expect((error as IncompleteVitalsHistoryError).observedFlags.map((flag) => flag.id)).toEqual(['spo2_low']);
    }
  });
  it('rejects unknown context versions and invalid dates', () => {
    expect(() => evaluateCapturedVitals({ ...receipt(), context_version: 2 })).toThrow();
    expect(() => evaluateCapturedVitals({ ...receipt(), captured_at: 'not-a-date' })).toThrow();
  });
  it('rejects unknown flags rather than dropping them and displaying normal', () => {
    expect(() => flagsFromReceipt(['unknown'])).toThrow();
    expect(() => flagsFromReceipt(null)).toThrow();
    expect(flagsFromReceipt([])).toEqual([]);
    expect(flagsFromReceipt(['spo2_low'])[0].severity).toBe('critical');
  });
});
