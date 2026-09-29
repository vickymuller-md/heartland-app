import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateScanSnapshot, SCAN_RECIPE, SCAN_RULES, type ScanRule } from '@/lib/dashboard/scan-evaluation';
import { evaluateCriticalLabs, evaluateFollowupDue, evaluateFollowupOverdue, evaluateNoCheckin,
  evaluateWeightTrend7d, evaluateLowAdherence } from '@/lib/dashboard/alert-engine';
import { computeAdherenceDay } from '@/lib/medications/queries';
import type { MedicationFrequency, MedicationLog, MedicationRow } from '@/lib/medications/types';
import type { EffectiveLabObservation } from '@/lib/labs/effective';

const clock = '2026-09-24T08:00:00.000000Z';
const uuid = (n: number) => `47000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ago = (days: number) => new Date(Date.parse(clock) - days * 86_400_000).toISOString();
const dates = Array.from({ length: 7 }, (_, index) => ago(6 - index).slice(0, 10));
const lab = (n: number, analyte: 'potassium' | 'egfr', value: string, collected = clock): EffectiveLabObservation => ({
  id: `${uuid(n)}:${analyte}`, patient_id: uuid(998), original_lab_result_id: uuid(n), analyte,
  root_id: null, version_id: null, revision: null, status: 'original', effective_lab_result_id: uuid(n),
  value, collected_at: collected, notes: null, lab_facility: null, evaluation_status: null,
});
const snapshot = () => ({ receipt_id: uuid(999), patient_id: uuid(998), recipe: SCAN_RECIPE, captured_at: clock, calendar_timezone: 'UTC', calendar_dates: dates,
  sources: {
    checkin: { patient_created_at: ago(30), latest_vital: { id: uuid(1), recorded_at: ago(1) } },
    weights: [{ id: uuid(1), weight_lbs: 180, recorded_at: ago(1) }],
    adherence: { medications: [] as { id: string; frequency: string | null }[],
      logs: [] as { id: string; medication_id: string; scheduled_date: string; taken: boolean }[] },
    effective_labs: { potassium: [] as EffectiveLabObservation[], egfr: [] as EffectiveLabObservation[] },
    followups: [] as { id: string; scheduled_at: string; completed: boolean }[],
    acute_alerts: [] as { id: string; flags: string[]; status: 'open' | 'acknowledged' }[],
  },
});
const decision = (input: unknown, rule: ScanRule) => evaluateScanSnapshot(input).find((result) => result.rule === rule)!;
const triggers = (input: unknown, rule: ScanRule) => decision(input, rule).decision === 'triggered';
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('recoverable scan frozen evaluator', () => {
  it('retires only legacy laboratory rules without changing the other five decisions', () => {
    const input = snapshot();
    const legacy = { ...input, recipe: 'proactive-frozen-v1', patient_id: undefined,
      sources: { ...input.sources, latest_labs: [{ id: uuid(5), potassium: 6.2, egfr: 20, collected_at: clock }] } };
    const rows = evaluateScanSnapshot(legacy);
    expect(rows.filter((row) => ['hyperkalemia', 'low_egfr'].includes(row.rule))
      .every((row) => row.decision === 'blocked' && row.reason === 'legacy_recipe' && row.source_ids.length === 0)).toBe(true);
    expect(rows.filter((row) => !['hyperkalemia', 'low_egfr'].includes(row.rule)))
      .toEqual(evaluateScanSnapshot(input).filter((row) => !['hyperkalemia', 'low_egfr'].includes(row.rule)));
  });
  it.each([
    ['potassium', '5.50000000000000000000000001', true], ['potassium', '5.50000000000000000000000000', false],
    ['potassium', '5.49999999999999999999999999', false], ['egfr', '29.9999999999999999999999999', true],
    ['egfr', '30.0000000000000000000000000', false], ['egfr', '30.0000000000000000000000001', false],
    ['egfr', '20', true], ['potassium', '9007199254740993', true],
  ] as const)('compares %s exact decimal %s without floating-point rounding', (analyte, value, triggered) => {
    const input = snapshot(); input.sources.effective_labs[analyte] = [lab(5, analyte, value)];
    expect(triggers(input, analyte === 'potassium' ? 'hyperkalemia' : 'low_egfr')).toBe(triggered);
  });
  it('keeps independent collection times and version identities for K and eGFR', () => {
    const input = snapshot();
    input.sources.effective_labs.potassium = [{ ...lab(5, 'potassium', '4.2'), status: 'corrected', root_id: uuid(10),
      version_id: uuid(11), revision: '2', effective_lab_result_id: uuid(12) }];
    input.sources.effective_labs.egfr = [lab(5, 'egfr', '20', ago(3))];
    expect(decision(input, 'hyperkalemia')).toMatchObject({ decision: 'not_triggered', source_ids: [uuid(11)] });
    expect(decision(input, 'low_egfr')).toMatchObject({ decision: 'triggered', source_ids: [uuid(5)] });
    Object.assign(input.sources.effective_labs.potassium[0], { status: 'cancelled', value: null, effective_lab_result_id: null, revision: '3' });
    expect(decision(input, 'hyperkalemia')).toMatchObject({ decision: 'blocked', reason: 'cancelled_source' });
    expect(triggers(input, 'low_egfr')).toBe(true);
  });
  it('accepts equivalent decimal ties, but a cancellation at that time blocks only its analyte', () => {
    const input = snapshot(); input.sources.effective_labs.potassium = [lab(5, 'potassium', '06.20'), lab(6, 'potassium', '6.2')];
    input.sources.effective_labs.potassium[1].collected_at = '2026-09-24T04:00:00-04:00';
    expect(decision(input, 'hyperkalemia')).toMatchObject({ decision: 'triggered', source_ids: [uuid(5), uuid(6)] });
    Object.assign(input.sources.effective_labs.potassium[1], { status: 'cancelled', root_id: uuid(10), version_id: uuid(11),
      revision: '2', effective_lab_result_id: null, value: null });
    expect(decision(input, 'hyperkalemia').reason).toBe('cancelled_source');
  });
  it('preserves microsecond capture boundaries and rejects future collection', () => {
    const input = snapshot(); input.captured_at = '2026-09-24T08:00:00.000500Z';
    input.sources.effective_labs.potassium = [lab(5, 'potassium', '6.2', input.captured_at)];
    expect(triggers(input, 'hyperkalemia')).toBe(true);
    input.sources.effective_labs.potassium[0].collected_at = '2026-09-24T08:00:00.000501Z';
    expect(decision(input, 'hyperkalemia').reason).toBe('invalid_source');
  });
  it.each(['patient', 'analyte', 'version', 'duplicate', 'negative', 'null', 'nan', 'overflow', 'notes', 'evaluation'])
  ('blocks invalid effective source %s without raw fallback', (fault) => {
    const input = snapshot(); const row = lab(5, 'potassium', '6.2'); input.sources.effective_labs.potassium = [row];
    if (fault === 'patient') row.patient_id = uuid(997);
    if (fault === 'analyte') row.analyte = 'egfr';
    if (fault === 'version') row.status = 'corrected';
    if (fault === 'duplicate') input.sources.effective_labs.potassium.push(row);
    if (fault === 'negative') row.value = '-6';
    if (fault === 'null') row.value = null;
    if (fault === 'nan') row.value = 'NaN';
    if (fault === 'overflow') row.value = '6'.repeat(257);
    if (fault === 'notes') row.notes = 'unneeded private detail';
    if (fault === 'evaluation') row.evaluation_status = 'pending';
    expect(decision({ ...input, sources: { ...input.sources,
      latest_labs: [{ id: uuid(4), potassium: 4.5, egfr: 50, collected_at: clock }] } }, 'hyperkalemia').decision).toBe('blocked');
  });
  it('rejects absent groups and patient identity rather than interpreting them as empty', () => {
    const input = snapshot();
    expect(decision({ ...input, sources: { ...input.sources, effective_labs: undefined } }, 'hyperkalemia').decision).toBe('blocked');
    expect(evaluateScanSnapshot({ ...input, patient_id: undefined }).every((row) => row.reason === 'invalid_context')).toBe(true);
  });
  it('returns exactly seven distinguishable decisions, never a normal or delivered label', () => {
    const rows = evaluateScanSnapshot(snapshot());
    expect(rows.map((row) => row.rule)).toEqual([...SCAN_RULES]);
    expect(rows.every((row) => row.receipt_id === uuid(999))).toBe(true);
    expect(rows.every((row) => row.decision !== 'triggered' && row.severity === null)).toBe(true);
    expect(decision(snapshot(), 'low_adherence').decision).toBe('not_applicable');
    expect(decision(snapshot(), 'hyperkalemia').decision).toBe('not_applicable');
  });
  it.each([null, {}, { ...snapshot(), recipe: 'future-version' }, { ...snapshot(), captured_at: 'yesterday' },
    { ...snapshot(), calendar_timezone: 'Invalid/Zone' }, { ...snapshot(), calendar_dates: [...dates].reverse() },
    { ...snapshot(), calendar_dates: Array(7).fill(dates[6]) },
    { ...snapshot(), calendar_dates: [...dates.slice(0, 6), '2026-02-30'] }])('blocks invalid envelope %#', (input) => {
    expect(evaluateScanSnapshot(input).every((row) => row.decision === 'blocked' && row.reason === 'invalid_context')).toBe(true);
  });
  it('freezes time across retries and does not mutate its input', () => {
    const input = snapshot(); const before = structuredClone(input);
    const first = evaluateScanSnapshot(input);
    vi.useFakeTimers(); vi.setSystemTime('2029-01-01T00:00:00Z');
    expect(evaluateScanSnapshot(input)).toEqual(first); expect(input).toEqual(before);
  });
  it('retains valid receipt identity on invalid context without inventing one for malformed input', () => {
    expect(evaluateScanSnapshot({ ...snapshot(), calendar_timezone: 'Invalid/Zone' })
      .every((row) => row.receipt_id === uuid(999) && row.reason === 'invalid_context')).toBe(true);
    expect(evaluateScanSnapshot({}).every((row) => row.receipt_id === null)).toBe(true);
  });
  it.each([0, 2.999, 3, 3.001, 10])('keeps no-checkin strict threshold/grace at %s days', (days) => {
    const input = snapshot(); input.sources.checkin.latest_vital.recorded_at = ago(days);
    expect(triggers(input, 'no_checkin')).toBe(evaluateNoCheckin(ago(days), ago(30), undefined, new Date(clock)));
    input.sources.checkin.patient_created_at = ago(days);
    input.sources.checkin.latest_vital.recorded_at = ago(30);
    expect(triggers(input, 'no_checkin')).toBe(evaluateNoCheckin(ago(30), ago(days), undefined, new Date(clock)));
  });
  it('keeps absent confirmed vitals distinct from failed source reads', () => {
    const input = snapshot();
    expect(decision({ ...input, sources: { ...input.sources, checkin: { patient_created_at: ago(30), latest_vital: null } } },
      'no_checkin').decision).toBe('triggered');
    expect(decision({ ...input, sources: { ...input.sources, checkin: undefined } }, 'no_checkin').decision).toBe('blocked');
  });
  it.each([0, 1.999, 2, 2.001, 3, 5])('keeps weight gain threshold %s', (gain) => {
    const input = snapshot(); input.sources.weights.push({ id: uuid(2), weight_lbs: 180 + gain, recorded_at: clock });
    expect(triggers(input, 'weight_trend_7d')).toBe(evaluateWeightTrend7d(input.sources.weights));
  });
  it('retains seven-day inclusive lower bound and existing future-weight handling', () => {
    const input = snapshot(); input.sources.weights = [
      { id: uuid(1), weight_lbs: 170, recorded_at: ago(7) }, { id: uuid(2), weight_lbs: 180, recorded_at: ago(-1) },
    ];
    expect(triggers(input, 'weight_trend_7d')).toBe(true);
    input.sources.weights[0].recorded_at = ago(7.001);
    expect(decision(input, 'weight_trend_7d').decision).toBe('blocked');
  });
  it('blocks conflicting boundary ties, including equivalent timezone instants', () => {
    const input = snapshot(); input.sources.weights = [
      { id: uuid(1), weight_lbs: 170, recorded_at: clock },
      { id: uuid(2), weight_lbs: 180, recorded_at: '2026-09-24T04:00:00-04:00' },
    ];
    expect(decision(input, 'weight_trend_7d').reason).toBe('ambiguous_source');
    input.sources.weights[1].weight_lbs = 170;
    expect(decision(input, 'weight_trend_7d').decision).toBe('not_triggered');
  });
  it('preserves microsecond weight ordering even within one JavaScript millisecond', () => {
    const input = snapshot(); input.sources.weights = [
      { id: uuid(1), weight_lbs: 180, recorded_at: '2026-09-24T08:00:00.000200Z' },
      { id: uuid(2), weight_lbs: 170, recorded_at: '2026-09-24T08:00:00.000100Z' },
    ];
    expect(triggers(input, 'weight_trend_7d')).toBe(true);
  });
  it('preserves acute suppression but an unreadable alert context cannot become empty', () => {
    const input = snapshot(); input.sources.weights.push({ id: uuid(2), weight_lbs: 190, recorded_at: clock });
    input.sources.acute_alerts = [{ id: uuid(3), flags: ['weight_gain_3lb_2d'], status: 'acknowledged' }];
    expect(decision(input, 'weight_trend_7d')).toMatchObject({ decision: 'suppressed', reason: 'acute_weight_active', source_ids: [uuid(3)] });
    expect(decision({ ...input, sources: { ...input.sources, acute_alerts: null } }, 'weight_trend_7d').decision).toBe('blocked');
  });
  it.each([null, 5, 5.5, 5.501, 6])('keeps potassium threshold %s', (potassium) => {
    const input = snapshot();
    input.sources.effective_labs.potassium = potassium === null ? [] : [lab(5, 'potassium', String(potassium))];
    expect(triggers(input, 'hyperkalemia')).toBe(evaluateCriticalLabs({ potassium, egfr: 30 }).includes('hyperkalemia'));
  });
  it.each([null, 0, 29.999, 30, 31])('keeps eGFR threshold %s', (egfr) => {
    const input = snapshot();
    input.sources.effective_labs.egfr = egfr === null ? [] : [lab(5, 'egfr', String(egfr))];
    expect(triggers(input, 'low_egfr')).toBe(evaluateCriticalLabs({ potassium: 5.5, egfr }).includes('low_egfr'));
  });
  it('handles ambiguity per analyte without hiding an independent known critical value', () => {
    const input = snapshot(); input.sources.effective_labs = {
      potassium: [lab(5, 'potassium', '6'), lab(6, 'potassium', '4')],
      egfr: [lab(5, 'egfr', '20'), lab(6, 'egfr', '20')],
    };
    expect(decision(input, 'hyperkalemia').reason).toBe('ambiguous_source');
    expect(decision(input, 'low_egfr').decision).toBe('triggered');
    input.sources.effective_labs.egfr[1].collected_at = ago(1);
    expect(decision(input, 'low_egfr').decision).toBe('blocked');
  });
  it.each([-24, -0.001, 0, 23.999, 24, 71.999, 72, 72.001, 168])('keeps follow-up boundaries %s hours', (hoursAgo) => {
    const input = snapshot(); const row = { id: uuid(7), scheduled_at: ago(hoursAgo / 24), completed: false };
    input.sources.followups = [row];
    expect(triggers(input, 'followup_due')).toBe(evaluateFollowupDue(row.scheduled_at, false, undefined, new Date(clock)));
    const expected = evaluateFollowupOverdue(row.scheduled_at, false, new Date(clock));
    expect(triggers(input, 'followup_overdue')).toBe(expected !== null);
    expect(decision(input, 'followup_overdue').severity).toBe(expected?.severity ?? null);
  });
  it('chooses only the highest severity actually returned, independent of query order', () => {
    const input = snapshot(); input.sources.followups = [
      { id: uuid(7), scheduled_at: ago(1), completed: false },
      { id: uuid(8), scheduled_at: ago(4), completed: false },
    ];
    const original = evaluateScanSnapshot(input);
    expect(decision(input, 'followup_overdue').severity).toBe('critical');
    input.sources.followups.reverse(); expect(evaluateScanSnapshot(input)).toEqual(original);
    input.sources.followups[0].completed = true;
    expect(decision(input, 'followup_overdue').severity).toBe('warning');
  });
  it('partitions due and overdue at the exact database instant before millisecond engine comparisons', () => {
    const input = snapshot(); input.captured_at = '2026-09-24T08:00:00.000500Z';
    input.sources.followups = [{ id: uuid(7), scheduled_at: '2026-09-24T08:00:00.000100Z', completed: false }];
    expect(triggers(input, 'followup_due')).toBe(false);
    input.sources.followups[0].scheduled_at = '2026-09-24T08:00:00.000500Z';
    expect(triggers(input, 'followup_due')).toBe(true);
    input.sources.followups[0].scheduled_at = '2026-09-24T08:00:00.000900Z';
    expect(triggers(input, 'followup_due')).toBe(true);
    input.sources.followups[0].scheduled_at = '2026-09-24T08:00:00.0009001Z';
    expect(decision(input, 'followup_due').decision).toBe('blocked');
  });
  it.each(['once_daily', 'twice_daily', 'three_times_daily', 'four_times_daily', 'as_needed', 'weekly'] as MedicationFrequency[])
  ('preserves the existing adherence recipe for %s, including weekly', (frequency) => {
    const input = snapshot(); input.sources.adherence.medications = [{ id: uuid(10), frequency }];
    for (let count = 0; count <= 7; count++) {
      input.sources.adherence.logs = dates.slice(0, count).map((date, i) => ({ id: uuid(20 + i), medication_id: uuid(10), scheduled_date: date, taken: true }));
      const legacy = dates.map((date) => computeAdherenceDay(date,
        [{ frequency } as MedicationRow], input.sources.adherence.logs as MedicationLog[], new Date(`${dates[6]}T12:00:00`)));
      expect(triggers(input, 'low_adherence')).toBe(evaluateLowAdherence(legacy));
    }
  });
  it('keeps legacy inactive-medication logs in the count, but rejects unknown frequency', () => {
    const input = snapshot(); input.sources.adherence.medications = [{ id: uuid(10), frequency: 'once_daily' }];
    input.sources.adherence.logs = dates.map((date, i) => ({ id: uuid(20 + i), medication_id: uuid(11), scheduled_date: date, taken: true }));
    expect(triggers(input, 'low_adherence')).toBe(false);
    input.sources.adherence.medications[0].frequency = 'not-defined';
    expect(decision(input, 'low_adherence').decision).toBe('blocked');
    input.sources.adherence.medications[0].frequency = null;
    expect(decision(input, 'low_adherence').decision).toBe('blocked');
  });
  it('uses the frozen timezone calendar across midnight and DST, independent of runtime timezone', () => {
    const input = snapshot(); input.captured_at = '2026-03-09T01:00:00Z'; input.calendar_timezone = 'America/New_York';
    input.calendar_dates = Array.from({ length: 7 }, (_, index) => `2026-03-${String(index + 2).padStart(2, '0')}`);
    input.sources.checkin.patient_created_at = '2026-01-01T00:00:00Z';
    input.sources.weights = [];
    input.sources.adherence.medications = [{ id: uuid(10), frequency: 'once_daily' }];
    for (const timezone of ['UTC', 'Pacific/Honolulu', 'Asia/Tokyo']) {
      vi.stubEnv('TZ', timezone);
      expect(decision(input, 'low_adherence').decision).toBe('triggered');
    }
    input.calendar_dates[6] = '2026-03-09';
    expect(decision(input, 'low_adherence').reason).toBe('invalid_context');
  });
  it('does not read mute preferences or allow them to suppress detection', () => {
    const input = snapshot(); input.sources.checkin.latest_vital.recorded_at = ago(10);
    expect(evaluateScanSnapshot({ ...input, muted_types: [...SCAN_RULES] })).toEqual(evaluateScanSnapshot(input));
    expect(triggers(input, 'no_checkin')).toBe(true);
  });
  it('does not convert missing or malformed groups to empty, and keeps unaffected rules', () => {
    const input = snapshot(); input.sources.effective_labs.potassium = [lab(5, 'potassium', '6.2')];
    for (const source of ['checkin', 'weights', 'adherence', 'followups', 'acute_alerts']) {
      const bad = { ...input, sources: { ...input.sources, [source]: undefined } };
      expect(triggers(bad, 'hyperkalemia')).toBe(true);
      expect(evaluateScanSnapshot(bad).some((row) => row.decision === 'blocked')).toBe(true);
    }
  });
  it('rejects overflow, duplicate source IDs and nonfinite measurements', () => {
    const input = snapshot(); input.sources.weights = Array.from({ length: 1001 }, (_, index) => ({ id: uuid(index + 1), weight_lbs: 180, recorded_at: clock }));
    expect(decision(input, 'weight_trend_7d').decision).toBe('blocked');
    input.sources.weights = [input.sources.weights[0], input.sources.weights[0]];
    expect(decision(input, 'weight_trend_7d').decision).toBe('blocked');
    input.sources.weights = [{ id: uuid(1), weight_lbs: Infinity, recorded_at: clock }];
    expect(decision(input, 'weight_trend_7d').decision).toBe('blocked');
  });
});
