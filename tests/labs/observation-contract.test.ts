import { describe, expect, it } from 'vitest';
import { observationInputFromState, observationInputSchema, observationMatches, observationPendingPageSchema,
  observationSourceSchema, observationStateSchema } from '@/lib/labs/observation-types';

const id = (n: number) => `61000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const instant = '2026-09-29T12:00:00.123456-04:00';
const input = { actor_id: id(1), organization_id: id(90), patient_id: id(11), request_id: id(1100), root_id: id(2100),
  original_lab_result_id: id(100), analyte: 'potassium', command: 'register_source', expected_revision: '0',
  payload: { evidence: '  Synthetic original_document  ', occurred_at: instant } };
const prepared = { ...input, source_snapshot: { value: '9007199254740993.123456789', collected_at: instant },
  state: 'prepared', recorded_at: instant, acknowledged_at: null, receipt: null };
const receipt = { request_id: id(1100), root_id: id(2100), version_id: id(3100), revision: '1', original_lab_result_id: id(100),
  analyte: 'potassium', recorded_at: instant, source_authority_registered: true, order_authorship_confirmed: false,
  clinical_review_recorded: false, care_completed: false };
const applied = { ...prepared, state: 'applied', receipt };

const changeInput = { ...input, request_id: id(8000), command: 'correct_source', expected_revision: '1',
  payload: { ...input.payload, reason: '  Corrected synthetic report  ', value: '4.20', collected_at: instant } };
const head = { version_id: id(3100), revision: '1', status: 'original', effective_lab_result_id: id(100),
  value: '4.6', collected_at: instant };
const changePrepared = { ...changeInput, source_snapshot: head, state: 'prepared', recorded_at: instant, acknowledged_at: null, receipt: null };
const changeReceipt = { request_id: id(8000), root_id: id(2100), version_id: id(3101), revision: '2', previous_version_id: id(3100),
  original_lab_result_id: id(100), analyte: 'potassium', status: 'corrected', effective_lab_result_id: id(4000),
  stored_source: { value: '4.2', collected_at: '2026-09-29T16:00:00.123456Z' }, evaluation_status: 'pending', recorded_at: instant,
  source_change_recorded: true, work_invalidation_recorded: false, order_authorship_confirmed: false,
  clinical_review_recorded: false, care_completed: false };
const changeApplied = { ...changePrepared, state: 'applied', receipt: changeReceipt };

describe('source amendment contract', () => {
  it('preserves exact frozen spelling but accepts the numerically equal stored scale and timezone', () => {
    expect(observationStateSchema.parse(changeApplied)).toEqual(changeApplied);
    expect(observationInputFromState(observationStateSchema.parse(changePrepared))).toEqual(changeInput);
    expect(observationMatches(observationStateSchema.parse(changePrepared), observationInputSchema.parse({ ...changeInput,
      payload: { ...changeInput.payload, value: '4.2' } }))).toBe(false);
  });
  it.each(['0', '-1', '1.0', '01', '1e3', '9223372036854775807', '9223372036854775808', '9'.repeat(100)])('rejects invalid expected revision %s without throwing', (value) => {
    expect(observationStateSchema.safeParse({ ...changePrepared, expected_revision: value }).success).toBe(false);
  });
  it('does not round revisions larger than Number safe integer', () => {
    const large = { ...changeApplied, expected_revision: '9007199254740993', source_snapshot: { ...head, status: 'corrected', revision: '9007199254740993', effective_lab_result_id: id(3999) },
      receipt: { ...changeReceipt, revision: '9007199254740994' } };
    expect(observationStateSchema.parse(large)).toEqual(large);
    expect(observationStateSchema.safeParse({ ...large, receipt: { ...large.receipt, revision: '9007199254740993' } }).success).toBe(false);
  });
  it.each([{ value: '4.21', collected_at: instant }, { value: null, collected_at: instant },
    { value: '4.2', collected_at: '2026-09-29T16:00:00.123455Z' }])('rejects a changed stored source %#', (stored_source) => {
    expect(observationStateSchema.safeParse({ ...changeApplied, receipt: { ...changeReceipt, stored_source } }).success).toBe(false);
  });
  it.each([{ previous_version_id: id(999) }, { version_id: head.version_id }, { revision: '3' }, { request_id: id(999) },
    { status: 'cancelled' }, { effective_lab_result_id: id(100) }, { effective_lab_result_id: null }, { evaluation_status: null },
    { work_invalidation_recorded: true }, { clinical_review_recorded: true }, { care_completed: true }, { delivered: true }])('rejects mismatched or overclaiming amendment receipt %#', (change) => {
    expect(observationStateSchema.safeParse({ ...changeApplied, receipt: { ...changeReceipt, ...change } }).success).toBe(false);
  });
  it.each([{ effective_lab_result_id: null }, { value: null }, { revision: '2' }, { status: 'corrected' }, { status: 'cancelled' }])('rejects inconsistent frozen head %#', (change) => {
    expect(observationStateSchema.safeParse({ ...changePrepared, source_snapshot: { ...head, ...change } }).success).toBe(false);
  });
  it('decodes cancellation with no invented source/evaluation and an unchanged collection anchor', () => {
    const cancelled = { ...changeApplied, command: 'cancel_source', payload: { ...input.payload, reason: 'Invalid synthetic source' },
      receipt: { ...changeReceipt, status: 'cancelled', effective_lab_result_id: null, stored_source: { value: null, collected_at: instant }, evaluation_status: null } };
    expect(observationStateSchema.parse(cancelled)).toEqual(cancelled);
    expect(observationStateSchema.safeParse({ ...cancelled, source_snapshot: { ...head, revision: '1', status: 'cancelled', value: null, effective_lab_result_id: null } }).success).toBe(false);
    expect(observationStateSchema.safeParse({ ...cancelled, receipt: { ...cancelled.receipt, stored_source: { value: null, collected_at: '2026-09-29T16:00:00.123455Z' } } }).success).toBe(false);
  });
  it('permits an explicit new correction after cancellation, never implicit resurrection', () => {
    const restored = { ...changeApplied, expected_revision: '3', source_snapshot: { ...head, revision: '3', status: 'cancelled', value: null, effective_lab_result_id: null },
      receipt: { ...changeReceipt, revision: '4' } };
    expect(observationStateSchema.parse(restored)).toEqual(restored);
    expect(observationStateSchema.safeParse({ ...restored, command: 'cancel_source', payload: { ...input.payload, reason: 'Again' } }).success).toBe(false);
  });
  it('decodes mixed recovery pages without losing registration receipts', () => {
    const items = [applied, changePrepared];
    expect(observationPendingPageSchema.parse({ items, next_cursor: null }).items).toHaveLength(2);
  });
});

describe('source authority registration contract', () => {
  it('preserves historical microseconds, evidence whitespace and arbitrary decimal precision', () => {
    expect(observationStateSchema.parse(prepared)).toEqual(prepared);
    expect(observationStateSchema.parse(applied)).toEqual(applied);
    expect(observationInputFromState(observationStateSchema.parse(prepared))).toEqual(input);
  });
  it('does not equate registration with ordering, clinical review or care completion', () => {
    expect(observationStateSchema.parse(applied).receipt).toMatchObject({ order_authorship_confirmed: false,
      clinical_review_recorded: false, care_completed: false });
  });
  it.each(['actor_id', 'organization_id', 'patient_id', 'request_id', 'root_id', 'original_lab_result_id'] as const)(
    'matches the frozen %s, not only a request ID', (key) => {
      const state = observationStateSchema.parse(prepared);
      expect(observationMatches(state, observationInputSchema.parse(input))).toBe(true);
      expect(observationMatches(state, observationInputSchema.parse({ ...input, [key]: id(9999) }))).toBe(false);
    });
  it('ignores JSON property order but preserves exact frozen text and instant spelling', () => {
    const state = observationStateSchema.parse(prepared);
    expect(observationMatches(state, observationInputSchema.parse({ ...input, payload: {
      occurred_at: instant, evidence: input.payload.evidence } }))).toBe(true);
    expect(observationMatches(state, observationInputSchema.parse({ ...input, payload: {
      ...input.payload, evidence: input.payload.evidence.trim() } }))).toBe(false);
    expect(observationMatches(state, observationInputSchema.parse({ ...input, payload: {
      ...input.payload, occurred_at: '2026-09-29T16:00:00.123456Z' } }))).toBe(false);
  });
  it('compares GUIDs without rewriting their representation', () => {
    const upper = 'ABCDEFAB-CDEF-ABCD-EFAB-ABCDEFABCDEF';
    const state = observationStateSchema.parse({ ...prepared, root_id: upper });
    expect(observationMatches(state, observationInputSchema.parse({ ...input, root_id: upper.toLowerCase() }))).toBe(true);
    expect(state.root_id).toBe(upper);
    expect(observationStateSchema.safeParse({ ...applied, root_id: upper, receipt: { ...receipt, root_id: upper.toLowerCase() } }).success).toBe(true);
  });
  it.each([{ request_id: id(9) }, { root_id: id(9) }, { original_lab_result_id: id(9) }, { analyte: 'creatinine' },
    { revision: '2' }, { revision: 1 }, { source_authority_registered: false }, { order_authorship_confirmed: true },
    { clinical_review_recorded: true }, { care_completed: true }, { normal: true }])('rejects a mismatched or overclaiming receipt %#', (change) => {
    expect(observationStateSchema.safeParse({ ...applied, receipt: { ...receipt, ...change } }).success).toBe(false);
  });
  it.each(['NaN', 'Infinity', '-1', '1e3', '.5', '5.', ' 4.6', '4.6 ', '', 4.6, null])('rejects noncanonical source value %s', (value) => {
    expect(observationSourceSchema.safeParse({ ...prepared.source_snapshot, value }).success).toBe(false);
  });
  it.each(['2026-09-29T12:00:00', '2026-09-29', '2026-09-29T12:00Z', '2026-02-30T12:00:00Z', 'infinity',
    '2026-09-29T12:00:00.1234567Z'])('rejects unsupported timestamp %s', (occurred_at) => {
    expect(observationInputSchema.safeParse({ ...input, payload: { ...input.payload, occurred_at } }).success).toBe(false);
  });
  it.each(['', '  ', 'ab', 'x'.repeat(1001)])('rejects meaningless or oversized evidence %#', (evidence) => {
    expect(observationInputSchema.safeParse({ ...input, payload: { ...input.payload, evidence } }).success).toBe(false);
  });
  it('measures evidence by Unicode characters without trimming it', () => {
    const evidence = '𝒜'.repeat(1000);
    expect(observationInputSchema.parse({ ...input, payload: { ...input.payload, evidence } }).payload.evidence).toBe(evidence);
  });
  it.each([{ expected_revision: '1' }, { expected_revision: 0 }, { command: 'amend' }, { analyte: 'unknown' },
    { source_fingerprint: 'private' }, { payload: { ...input.payload, actor_id: id(1) } }])('rejects altered registration schema %#', (change) => {
    expect(observationInputSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it.each([{ state: 'applied', receipt: null }, { state: 'prepared', receipt }, { state: 'cancelled', receipt },
    { state: 'prepared', acknowledged_at: instant }, { state: 'cancelled', acknowledged_at: instant }])('rejects inconsistent receipt state %#', (change) => {
    expect(observationStateSchema.safeParse({ ...prepared, ...change }).success).toBe(false);
  });
  it('retains applied evidence after acknowledgement and cancellation of an unapplied preparation', () => {
    expect(observationStateSchema.parse({ ...applied, acknowledged_at: instant }).receipt).toEqual(receipt);
    expect(observationStateSchema.parse({ ...prepared, state: 'cancelled' }).receipt).toBeNull();
  });
  it('validates ordered 25-item recovery pages and their explicit tail', () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ ...prepared, request_id: id(1200 + index) }));
    expect(observationPendingPageSchema.parse({ items, next_cursor: id(1224) }).items).toHaveLength(25);
    expect(observationPendingPageSchema.parse({ items: [], next_cursor: null })).toEqual({ items: [], next_cursor: null });
    for (const page of [{ items, next_cursor: id(1223) }, { items: items.slice(0, 24), next_cursor: id(1223) },
      { items: [...items, { ...prepared, request_id: id(1225) }], next_cursor: null },
      { items: [prepared, prepared], next_cursor: null }, { items: [items[1], items[0]], next_cursor: null },
      { items: [{ ...prepared, state: 'cancelled' }], next_cursor: null },
      { items: [{ ...applied, acknowledged_at: instant }], next_cursor: null }]) {
      expect(observationPendingPageSchema.safeParse(page).success).toBe(false);
    }
  });
});
