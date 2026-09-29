import { describe, expect, it } from 'vitest';
import { labSourceAssessmentSchema, labEvaluationHistorySchema, labReceiptRowsSchema } from '@/lib/labs/evaluation';

const id = (n: number) => `65000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function assessment() {
  return { recipe: 'immediate-effective-v1', evaluated_at: '2026-01-02T00:00:00.000001Z', patient_id: id(1),
    lab_result_id: id(2), original_lab_result_id: id(2), analytes: {
      potassium: { reason: 'effective', event_source: { lab_result_id: id(2), value: '5.50000000000000001',
        collected_at: '2026-01-01T00:00:00.123456Z', root_id: id(3), version_id: id(4), revision: '1' },
      observed_head: { root_id: id(3), version_id: id(4), revision: '1', status: 'original',
        effective_lab_result_id: id(2), value: '5.50000000000000001', collected_at: '2026-01-01T00:00:00.123456Z' } },
      egfr: { reason: 'not_recorded', event_source: null, observed_head: null },
    } };
}
function excluded(reason: 'replaced' | 'cancelled') {
  const a = assessment(); const e = a.analytes.potassium;
  e.reason = reason; e.observed_head.revision = '2'; e.observed_head.version_id = id(5);
  return { ...a, analytes: { ...a.analytes, potassium: { ...e, observed_head: { ...e.observed_head,
    status: reason === 'replaced' ? 'corrected' : 'cancelled',
    effective_lab_result_id: reason === 'replaced' ? id(6) : null,
    value: reason === 'replaced' ? '4.2' : null } } } };
}
describe('historical immediate source assessment', () => {
  it('keeps decimal strings and collection microseconds without numeric coercion', () => {
    expect(labSourceAssessmentSchema.parse(assessment())).toEqual(assessment());
  });
  it.each(['replaced', 'cancelled'] as const)('accepts strictly later %s evidence', (reason) => {
    expect(labSourceAssessmentSchema.safeParse(excluded(reason)).success).toBe(true);
  });
  it.each(['', 'abc', '1.5', '0', '-1', '1'.repeat(20), '9223372036854775808'])('rejects revision %s without throwing', (revision) => {
    for (const key of ['event_source', 'observed_head'] as const) {
      const a = assessment(); a.analytes.potassium[key].revision = revision;
      expect(() => labSourceAssessmentSchema.safeParse(a)).not.toThrow();
      expect(labSourceAssessmentSchema.safeParse(a).success).toBe(false);
    }
  });
  it.each(['bad', '2026-01-01', '2026-01-01T00:00:00.1234567Z', '2026-02-31T00:00:00Z'])('rejects invalid instant %s safely', (instant) => {
    for (const field of ['evaluated', 'event', 'head']) {
      const a = assessment();
      if (field === 'evaluated') a.evaluated_at = instant;
      else a.analytes.potassium[field === 'event' ? 'event_source' : 'observed_head'].collected_at = instant;
      expect(() => labSourceAssessmentSchema.safeParse(a)).not.toThrow();
      expect(labSourceAssessmentSchema.safeParse(a).success).toBe(false);
    }
  });
  it.each(['replaced', 'cancelled'] as const)('rejects impossible same-revision/version %s evidence', (reason) => {
    for (const key of ['revision', 'version_id'] as const) {
      const a = excluded(reason); a.analytes.potassium.observed_head[key] = a.analytes.potassium.event_source[key];
      expect(labSourceAssessmentSchema.safeParse(a).success).toBe(false);
    }
  });
  it('rejects false inclusion, inherited absent analyte, and future collection', () => {
    const a = assessment(); a.analytes.potassium.observed_head.effective_lab_result_id = id(9);
    expect(labSourceAssessmentSchema.safeParse(a).success).toBe(false);
    const b = assessment(); b.analytes.potassium.reason = 'not_recorded';
    expect(labSourceAssessmentSchema.safeParse(b).success).toBe(false);
    const c = assessment(); c.evaluated_at = '2026-01-01T00:00:00.123455Z';
    expect(labSourceAssessmentSchema.safeParse(c).success).toBe(false);
  });
  it('requires status and assessment identity agreement, retaining legacy NULL history', () => {
    const row = { id: id(8), patient_id: id(1), lab_result_id: id(2), status: 'recorded', attempt_count: 1,
      source_assessment: assessment(), lab_results: null };
    expect(labEvaluationHistorySchema.safeParse(row).success).toBe(true);
    for (const patch of [{ patient_id: id(7) }, { lab_result_id: id(7) }, { status: 'pending' }, { status: 'invalidated' }]) {
      expect(labEvaluationHistorySchema.safeParse({ ...row, ...patch }).success).toBe(false);
    }
    expect(labEvaluationHistorySchema.safeParse({ ...row, source_assessment: null }).success).toBe(true);
    expect(labEvaluationHistorySchema.safeParse({ ...row, status: 'invalidated', source_assessment: null }).success).toBe(false);
    expect(labEvaluationHistorySchema.safeParse({ ...row, status: 'invalidated', source_assessment: excluded('cancelled') }).success).toBe(true);
  });
  it('requires one exact receipt and a recognized terminal status', () => {
    const row = { event_id: id(1), lab_result_id: id(2), status: 'invalidated' };
    expect(labReceiptRowsSchema.safeParse([row]).success).toBe(true);
    for (const value of [null, [], [row, row], [{ ...row, status: 'complete' }], [{ ...row, event_id: 'wrong' }]]) {
      expect(labReceiptRowsSchema.safeParse(value).success).toBe(false);
    }
  });
});
