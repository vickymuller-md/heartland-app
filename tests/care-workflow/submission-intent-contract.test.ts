import { describe, expect, it } from 'vitest';
import { submissionIntentInputFromState, submissionIntentInputSchema, submissionIntentMatches, submissionIntentPageSchema,
  submissionIntentStateSchema, validateNewSubmissionIntent } from '@/lib/care-workflow/submission-intent-types';

const id = (n: number) => `67000000-0000-4000-8000-${String(n).padStart(12, '0')}`; const at = '2026-09-01T12:00:00.123456-04:00';
const input = { intent_id: id(200), actor_id: id(1), organization_id: id(90), patient_id: id(11), work_item_id: id(100), submission_request_id: id(300),
  expected_revision: '1', expected_ownership_revision: '1', payload: { analytes: ['potassium', 'egfr'], evidence: '  Original source  ', occurred_at: at } };
const prepared = { ...input, state: 'prepared', recorded_at: at, cancelled_at: null, reconciled_at: null, reconciliation: null, result_linked: false, clinical_review_recorded: false, care_completed: false,
  submission: { status: 'awaiting_save', lab_result_id: null, event_id: null, evaluation_status: null, saved_at: null, acknowledged_at: null,
    recorded_analytes: [], missing_analytes: ['potassium', 'egfr'] } };
const saved = { ...prepared, submission: { status: 'saved_not_linked', lab_result_id: id(400), event_id: id(500), evaluation_status: 'pending', saved_at: at,
  acknowledged_at: null, recorded_analytes: ['creatinine', 'potassium'], missing_analytes: ['egfr'] } };
describe('pre-save follow-up intention contract', () => {
  it.each(['linked', 'not_used'])('retains the minimized historical %s resolution and releases only pending recovery', (disposition) => {
    const resolved = { ...saved, state: 'reconciled', reconciled_at: at, result_linked: disposition === 'linked',
      submission: { ...saved.submission, status: 'saved_reconciled' }, reconciliation: { event_id: id(900), disposition,
        matched_analytes: disposition === 'linked' ? ['potassium'] : [], missing_analytes: ['egfr'], recorded_at: at } };
    expect(submissionIntentStateSchema.parse(resolved)).toEqual(resolved);
    expect(submissionIntentInputFromState(submissionIntentStateSchema.parse(resolved))).toEqual(input);
    expect(submissionIntentPageSchema.safeParse({ items: [resolved], next_cursor: null }).success).toBe(false);
    for (const change of [{ result_linked: disposition !== 'linked' }, { state: 'prepared' }, { reconciliation: null }, { reconciled_at: null },
      { submission: saved.submission }, { reconciliation: { ...resolved.reconciliation, reason: 'Private other-owner rationale' } },
      { reconciliation: { ...resolved.reconciliation, matched_analytes: ['egfr'] } }, { reconciliation: { ...resolved.reconciliation, missing_analytes: [] } }]) {
      expect(submissionIntentStateSchema.safeParse({ ...resolved, ...change }).success).toBe(false);
    }
  });
  it('preserves exact payload/microseconds and separates source intention from saved evidence', () => {
    expect(submissionIntentStateSchema.parse(prepared)).toEqual(prepared);
    expect(submissionIntentStateSchema.parse(saved)).toEqual(saved);
    expect(submissionIntentInputFromState(submissionIntentStateSchema.parse(saved))).toEqual(input);
  });
  it('keeps an acknowledged partial save pending for association without inventing review', () => {
    const acknowledged = { ...saved, submission: { ...saved.submission, acknowledged_at: at, evaluation_status: 'invalidated' } };
    expect(submissionIntentPageSchema.parse({ items: [acknowledged], next_cursor: null }).items[0]).toEqual(acknowledged);
  });
  it('distinguishes independently cancelled submission from explicit intention cancellation', () => {
    const independent = { ...prepared, submission: { ...prepared.submission, status: 'submission_cancelled' } };
    expect(submissionIntentStateSchema.parse(independent).state).toBe('prepared');
    const cancelled = { ...independent, state: 'cancelled', cancelled_at: at };
    expect(submissionIntentStateSchema.parse(cancelled)).toEqual(cancelled);
    expect(submissionIntentPageSchema.safeParse({ items: [cancelled], next_cursor: null }).success).toBe(false);
  });
  it.each(['intent_id', 'actor_id', 'organization_id', 'patient_id', 'work_item_id', 'submission_request_id'] as const)('matches exact %s before mutation/recovery', (key) => {
    const state = submissionIntentStateSchema.parse(saved);
    expect(submissionIntentMatches(state, submissionIntentInputSchema.parse(input))).toBe(true);
    expect(submissionIntentMatches(state, submissionIntentInputSchema.parse({ ...input, [key]: id(999) }))).toBe(false);
  });
  it('does not equate trimmed evidence, reordered analytes or changed revision with the frozen request', () => {
    const state = submissionIntentStateSchema.parse(saved);
    for (const change of [{ expected_revision: '2' }, { expected_ownership_revision: '2' }, { payload: { ...input.payload, evidence: input.payload.evidence.trim() } },
      { payload: { ...input.payload, analytes: ['egfr', 'potassium'] } }]) {
      expect(submissionIntentMatches(state, submissionIntentInputSchema.parse({ ...input, ...change }))).toBe(false);
    }
  });
  it.each([[], ['potassium', 'potassium'], ['bnp'], ['ldl'], [4], ['unknown']])('rejects unsupported or ambiguous intent analytes %#', (analytes) => {
    expect(submissionIntentInputSchema.safeParse({ ...input, payload: { ...input.payload, analytes } }).success).toBe(false);
  });
  it.each([{ state: 'cancelled' }, { cancelled_at: at }, { result_linked: true }, { clinical_review_recorded: true }, { care_completed: true },
    { expected_revision: '0' }, { expected_revision: '01' }, { expected_revision: 'bad' }, { expected_revision: '9223372036854775808' },
    { expected_ownership_revision: '-1' }, { expected_ownership_revision: 1 }, { receipt: {} }])('rejects invalid or overclaiming state %#', (change) => {
    expect(submissionIntentStateSchema.safeParse({ ...saved, ...change }).success).toBe(false);
  });
  it.each([{ lab_result_id: null }, { event_id: null }, { evaluation_status: null }, { saved_at: null }, { status: 'linked' },
    { recorded_analytes: [] }, { recorded_analytes: ['potassium', 'creatinine'] }, { recorded_analytes: ['potassium', 'potassium'] },
    { missing_analytes: [] }, { missing_analytes: ['potassium'] }, { clinical_review: true }])('refuses inconsistent saved projection %#', (change) => {
    expect(submissionIntentStateSchema.safeParse({ ...saved, submission: { ...saved.submission, ...change } }).success).toBe(false);
  });
  it.each([{ lab_result_id: id(400) }, { event_id: id(500) }, { evaluation_status: 'pending' }, { saved_at: at }, { acknowledged_at: at },
    { recorded_analytes: ['potassium'] }])('does not invent evidence for an unsaved request %#', (change) => {
    expect(submissionIntentStateSchema.safeParse({ ...prepared, submission: { ...prepared.submission, ...change } }).success).toBe(false);
  });
  it('retains exact bigint revisions without numeric rounding', () => {
    const value = { ...prepared, expected_revision: '9007199254740993', expected_ownership_revision: '9223372036854775807' };
    expect(submissionIntentStateSchema.parse(value)).toEqual(value);
  });
  it('accepts25+tail with explicit ordered cursor and rejects repeated or truncated pages', () => {
    const items = Array.from({ length: 25 }, (_, n) => ({ ...saved, intent_id: id(200 + n) }));
    expect(submissionIntentPageSchema.parse({ items, next_cursor: id(224) }).items).toHaveLength(25);
    for (const page of [{ items, next_cursor: id(225) }, { items: items.slice(0, 24), next_cursor: id(223) },
      { items: [items[1], items[0]], next_cursor: null }, { items: [saved, saved], next_cursor: null }]) {
      expect(submissionIntentPageSchema.safeParse(page).success).toBe(false);
    }
  });
  it('validates fresh occurrence at microsecond precision without changing historical decoding', () => {
    const now = Date.parse('2026-09-01T17:00:00Z'); expect(validateNewSubmissionIntent(input, now)).toEqual(input);
    const future = { ...input, payload: { ...input.payload, occurred_at: '2026-09-01T17:00:00.000001Z' } };
    expect(submissionIntentInputSchema.safeParse(future).success).toBe(true); expect(validateNewSubmissionIntent(future, now)).toBeNull();
    expect(validateNewSubmissionIntent(input, NaN)).toBeNull();
    for (const occurred_at of ['2026-09-01T12:00:00', '2026-02-30T12:00:00Z', '2026-09-01T12:00:00.1234567Z']) {
      expect(submissionIntentInputSchema.safeParse({ ...input, payload: { ...input.payload, occurred_at } }).success).toBe(false);
    }
  });
});
