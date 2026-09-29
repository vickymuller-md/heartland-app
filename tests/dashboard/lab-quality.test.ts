import { describe, expect, it } from 'vitest';
import { assessLabAnalyte, assessEffectiveLab, labAttentionRank, labCollectionUTC, worklistLabContext, type LabQualityContext, type QualityPanel } from '@/lib/labs/quality';
import type { EffectiveLabObservation } from '@/lib/labs/effective';

const now = new Date('2026-09-29T12:00:00Z');
const context = worklistLabContext(now);
const panel = (changes: Partial<QualityPanel> = {}): QualityPanel => ({
  id: 'a', collected_at: '2026-09-28T12:00:00Z', potassium: 4.2, ...changes,
});

describe('Effective observation quality adapter', () => {
  const source: EffectiveLabObservation = { id: 'source:potassium', original_lab_result_id: 'source', patient_id: 'patient',
    analyte: 'potassium', root_id: 'root', version_id: 'version', revision: '2', status: 'corrected', effective_lab_result_id: 'amendment',
    value: '4.6000000000000001', collected_at: '2026-09-28T12:00:00.123456Z', notes: null, lab_facility: null, evaluation_status: 'pending' };
  const adapted = (items: EffectiveLabObservation[], rule = context) => assessEffectiveLab(items, 'patient', 'potassium', rule);
  it('displays exact corrected decimal and explicit provenance, not a rounded original value', () => {
    expect(adapted([source])).toMatchObject({ status: 'current', value: source.value, resultId: 'amendment',
      collectedAt: source.collected_at, source: { rootId: 'root', revision: '2', status: 'corrected', evaluationStatus: 'pending' } });
  });
  it('retains cancelled collection/provenance with no replacement value', () => {
    const old = { ...source, id: 'old:potassium', collected_at: '2026-09-01T12:00:00Z', value: '4.2' };
    const cancelled = { ...source, status: 'cancelled' as const, value: null, effective_lab_result_id: null, evaluation_status: null };
    expect(adapted([old, cancelled])).toMatchObject({ status: 'cancelled', value: null, resultId: null, collectedAt: source.collected_at });
    expect(labAttentionRank([adapted([cancelled])])).toBe(0);
  });
  it('preserves missing per-analyte status without borrowing another analyte date', () => {
    expect(assessEffectiveLab([source], 'patient', 'creatinine', context)).toMatchObject({ status: 'missing', value: null, collectedAt: null });
    expect(assessEffectiveLab([source], 'another-patient', 'potassium', context).status).toBe('missing');
  });
  it.each([{ value: '-1', collected_at: source.collected_at }, { value: 'NaN', collected_at: source.collected_at },
    { value: '4.6', collected_at: '2026-09-30T12:00:00Z' }])('does not present invalid evidence as available %#', (change) => {
    expect(adapted([{ ...source, ...change }])).toMatchObject({ status: 'invalid', value: null });
  });
  it('avoids an invalid date in render metadata and rejects an invalid quality context', () => {
    expect(adapted([{ ...source, collected_at: 'bad' }])).toMatchObject({ status: 'invalid', collectedAt: null });
    expect(() => adapted([source], { ...context, id: '' })).toThrow();
  });
  it('does not invent a recency policy for the patient brief', () => {
    expect(adapted([source], { id: 'brief', now })).toMatchObject({ status: 'recency_unassessed', value: source.value });
    expect(adapted([{ ...source, collected_at: '2026-08-01T12:00:00Z' }]).status).toBe('stale');
  });
});
const assess = (panels: QualityPanel[], rule: LabQualityContext = context) => assessLabAnalyte(panels, 'potassium', rule);

describe('Per-analyte evidence quality (not clinical suitability)', () => {
  it('does not manufacture values or refresh absent K from a new partial panel', () => {
    expect(assess([]).status).toBe('missing');
    expect(assess([panel({ potassium: null, creatinine: 1.1 })]).status).toBe('missing');
    const old = panel({ id: 'old', collected_at: '2026-08-01T12:00:00Z' });
    const recent = panel({ potassium: null, creatinine: 1.1 });
    expect(assess([old, recent])).toMatchObject({ status: 'stale', resultId: 'old', value: 4.2, collectedAt: old.collected_at });
    expect(assessLabAnalyte([old, recent], 'creatinine', context).status).toBe('current');
    expect(assessLabAnalyte([old, recent], 'egfr', context).status).toBe('missing');
  });
  it.each(['invalid', '2026-02-30T12:00:00Z', '2026-09-28', '2026-09-28T12:00:00'])('rejects ambiguous/impossible timestamp %s', (collected_at) => {
    expect(assess([panel({ collected_at })])).toMatchObject({ status: 'invalid', value: null, collectedAt: null });
  });
  it('does not fall back to an older valid result when newer evidence is future-dated', () => {
    expect(assess([panel(), panel({ id: 'new', collected_at: '2026-09-30T12:00:00Z' })]))
      .toMatchObject({ status: 'invalid', resultId: 'new', value: null });
  });
  it.each([NaN, Infinity, -1, '4.2'])('rejects malformed values without silently coercing %s', (value) => {
    expect(assess([panel({ potassium: value as number })])).toMatchObject({ status: 'invalid', value: null });
  });
  it('does not equate unit mismatch or conflicting values with current evidence', () => {
    expect(assess([panel({ units: { potassium: 'mg/dL' } })]).status).toBe('invalid');
    expect(assess([panel(), panel({ id: 'b', potassium: 5.7, collected_at: '2026-09-28T08:00:00-04:00' })]).status).toBe('invalid');
    expect(assess([panel(), panel({ id: 'b', units: { potassium: 'mmol/L' } })]).status).toBe('invalid');
  });
  it('deterministically handles identical same-time results and does not reorder inputs', () => {
    const panels = [panel({ id: 'b' }), panel({ id: 'a' })];
    expect(assess(panels)).toMatchObject({ status: 'current', resultId: 'a', value: 4.2 });
    expect(panels.map((p) => p.id)).toEqual(['b', 'a']);
  });
  it('preserves PostgreSQL microseconds in ordering, equality and visible evidence', () => {
    const older = panel({ collected_at: '2026-09-28T12:00:00.000001Z' });
    const newer = panel({ id: 'newer', potassium: 4.4, collected_at: '2026-09-28T08:00:00.000002-04:00' });
    expect(assess([older, newer])).toMatchObject({ status: 'current', value: 4.4, resultId: 'newer' });
    expect(labCollectionUTC(newer.collected_at)).toBe('2026-09-28T12:00:00.000002Z');
    expect(assess([newer, panel({ collected_at: '2026-09-28T12:00:00.000002Z' })]).status).toBe('invalid');
    expect(assess([panel({ collected_at: '2026-09-29T12:00:00.000001Z' })]).status).toBe('invalid');
  });
  it('retains the existing complete-day worklist advisory boundaries', () => {
    expect(assess([panel({ collected_at: '2026-09-15T12:00:00Z' })]).status).toBe('current');
    expect(assess([panel({ collected_at: '2026-09-14T12:00:01Z' })]).status).toBe('current');
    expect(assess([panel({ collected_at: '2026-09-14T12:00:00Z' })]).status).toBe('stale');
  });
  it('requires a supplied context-specific recency rule, without a default clinical cutoff', () => {
    expect(assess([panel()], { id: 'unconfigured', now })).toMatchObject({ status: 'recency_unassessed', value: 4.2 });
    expect(assess([panel()], { id: 'synthetic-test-window', now,
      isStale: (date) => Date.parse(date) < Date.parse('2026-09-29T00:00:00Z') }).status).toBe('stale');
  });
  it('does not classify an abnormal value as normal just because it is recent', () => {
    const result = assess([panel({ potassium: 6.2 })]);
    expect(result).toMatchObject({ status: 'current', value: 6.2 });
    expect(result.reason).toContain('not confirmation of clinical suitability');
  });
  it('orders missing/invalid evidence before stale before current, without assigning clinical severity', () => {
    expect(labAttentionRank([assess([])])).toBeLessThan(labAttentionRank([assess([panel({ collected_at: '2026-08-01T12:00:00Z' })])]));
    expect(labAttentionRank([assess([]), assess([panel()])])).toBe(0);
  });
  it('rejects an invalid context clock', () => {
    expect(() => assess([], { id: 'test', now: new Date('bad') })).toThrow('Invalid laboratory quality context');
  });
});
