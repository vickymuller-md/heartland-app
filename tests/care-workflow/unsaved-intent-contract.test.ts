import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { unsavedContextSchema, unsavedInputFromState, unsavedInputSchema, unsavedMatches, unsavedPendingPageSchema,
  unsavedStateSchema, unsavedHistoryPageSchema, validateNewUnsavedInput } from '@/lib/care-workflow/unsaved-intent-types';
const id = (n: number) => `be000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (n: number) => `2026-09-29T12:0${n}:00.123456Z`;
function fixture(cancelled = false) {
  const scope = { actor_id: id(1), organization_id: id(3), patient_id: id(2) };
  const snapshot = { intent_id: id(6), recorded_at: at(0), submission_status: cancelled ? 'submission_cancelled' : 'awaiting_save',
    submission_cancelled_at: cancelled ? at(1) : null };
  const input = { ...scope, request_id: id(10), work_item_id: id(5), intent_id: id(6), expected_revision: '1', expected_ownership_revision: '3',
    payload: { snapshot, occurred_at: at(2), evidence: '  Original evidence  ', reason: 'Explicit unsaved cancellation', unsaved_cancellation_acknowledged: true } };
  const receipt = { request_id: id(10), event_id: id(11), work_item_id: id(5), intent_id: id(6), workflow_revision: '1', ownership_revision: '3',
    recorded_at: at(4), submission_cancelled_at: cancelled ? at(1) : at(5), intent_cancelled_at: at(6),
    intention_cancelled: true, result_saved: false, result_linked: false, clinical_review_recorded: false, communication_confirmed: false, care_completed: false };
  const state = { ...input, recorded_at: at(3), state: 'applied', acknowledged_at: null, receipt };
  const context = { ...scope, work_item_id: id(5), workflow_revision: '1', ownership_revision: '3', snapshot };
  const history = { work_item_id: id(5), items: [{ event_id: id(11), actor_id: id(1), intent_id: id(6), recorded_at: at(4), payload: input.payload, receipt }], next_cursor: null };
  return { input, state, receipt, context, history };
}
describe('strict administrative unsaved intention contract', () => {
  it.each([false, true])('keeps the unchanged revision and exact snapshot cancelled=%s', (cancelled) => {
    const f = fixture(cancelled), state = unsavedStateSchema.parse(f.state), input = unsavedInputSchema.parse(f.input);
    expect(unsavedContextSchema.parse(f.context)).toEqual(f.context);
    expect(unsavedHistoryPageSchema.parse(f.history)).toEqual(f.history);
    expect(unsavedInputFromState(state)).toEqual(input); expect(unsavedMatches(state, input)).toBe(true);
    expect(state.receipt?.workflow_revision).toBe(input.expected_revision);
  });
  it.each(['result_saved', 'result_linked', 'clinical_review_recorded', 'communication_confirmed', 'care_completed'])('rejects invented %s', (key) => {
    const f = fixture(); expect(unsavedStateSchema.safeParse({ ...f.state, receipt: { ...f.receipt, [key]: true } }).success).toBe(false);
  });
  it.each(['request_id', 'work_item_id', 'intent_id', 'workflow_revision', 'ownership_revision', 'intention_cancelled'])('rejects changed receipt %s', (key) => {
    const f = fixture(); expect(unsavedStateSchema.safeParse({ ...f.state, receipt: { ...f.receipt,
      [key]: key.endsWith('revision') ? '4' : key === 'intention_cancelled' ? false : id(99) } }).success).toBe(false);
  });
  it.each(['-1', '01', '1.5', '9223372036854775808', 'Infinity', 'bad'])('rejects invalid revisions %s without throwing', (value) => {
    const f = fixture(); expect(unsavedInputSchema.safeParse({ ...f.input, expected_revision: value }).success).toBe(false);
    expect(unsavedInputSchema.safeParse({ ...f.input, expected_ownership_revision: value }).success).toBe(false);
  });
  it('allows the full bigint upper bound because this operation does not increment it', () => {
    const f = fixture(); expect(unsavedInputSchema.safeParse({ ...f.input, expected_revision: '9223372036854775807', expected_ownership_revision: '0' }).success).toBe(true);
    expect(unsavedInputSchema.safeParse({ ...f.input, expected_revision: '0' }).success).toBe(false);
  });
  it.each(['saved', 'saved_reconciled', 'cancelled'])('rejects unsupported snapshot state %s', (submission_status) => {
    const f = fixture(); f.input.payload.snapshot.submission_status = submission_status;
    expect(unsavedInputSchema.safeParse(f.input).success).toBe(false);
  });
  it.each([false, true])('requires snapshot cancellation time only for cancelled state %s', (cancelled) => {
    const f = fixture(cancelled); f.input.payload.snapshot.submission_cancelled_at = cancelled ? null : at(1);
    expect(unsavedInputSchema.safeParse(f.input).success).toBe(false);
  });
  it('does not rewrite a prior submission cancellation timestamp', () => {
    const f = fixture(true); f.receipt.submission_cancelled_at = at(5);
    expect(unsavedStateSchema.safeParse(f.state).success).toBe(false); expect(unsavedHistoryPageSchema.safeParse(f.history).success).toBe(false);
  });
  it('compares receipt instants at microsecond precision, including alternate offsets', () => {
    const f = fixture(true); f.receipt.submission_cancelled_at = '2026-09-29T08:01:00.123456-04:00';
    expect(unsavedStateSchema.safeParse(f.state).success).toBe(true);
    f.receipt.submission_cancelled_at = '2026-09-29T08:01:00.123455-04:00'; expect(unsavedStateSchema.safeParse(f.state).success).toBe(false);
  });
  it.each(['occurred_at', 'snapshot'])('rejects malformed timestamps in %s', (key) => {
    const f = fixture(); const value = '2026-09-29T12:02:00.1234567Z';
    if (key === 'occurred_at') f.input.payload.occurred_at = value; else f.input.payload.snapshot.recorded_at = value;
    expect(unsavedInputSchema.safeParse(f.input).success).toBe(false);
  });
  it('requires occurrence after the intention and any previous cancellation', () => {
    const f = fixture(true); f.input.payload.occurred_at = at(0); expect(unsavedInputSchema.safeParse(f.input).success).toBe(false);
    f.input.payload.occurred_at = '2026-09-29T11:59:00Z'; expect(unsavedInputSchema.safeParse(f.input).success).toBe(false);
  });
  it('does not use current time in historical decoding or recovery matching', () => {
    const f = fixture(), input = unsavedInputSchema.parse(f.input), state = unsavedStateSchema.parse(f.state);
    expect(validateNewUnsavedInput(input, Date.parse('2020-01-01T00:00:00Z'))).toBeNull();
    expect(validateNewUnsavedInput(input, NaN)).toBeNull(); expect(unsavedMatches(state, input)).toBe(true);
    expect(validateNewUnsavedInput(input, Date.parse(at(7)))).toEqual(input);
  });
  it.each(['evidence', 'reason'])('preserves frozen %s whitespace and rejects changed evidence', (key) => {
    const f = fixture(), state = unsavedStateSchema.parse(f.state), input = unsavedInputSchema.parse(f.input);
    Object.assign(input.payload, { [key]: 'Changed evidence' }); expect(unsavedMatches(state, input)).toBe(false);
    Object.assign(f.input.payload, { [key]: '   ' }); expect(unsavedInputSchema.safeParse(f.input).success).toBe(false);
  });
  it('rejects false acknowledgement, target substitution, extra private keys and clinical fields', () => {
    const f = fixture(); expect(unsavedInputSchema.safeParse({ ...f.input, intent_id: id(90) }).success).toBe(false);
    for (const extra of [{ unsaved_cancellation_acknowledged: false }, { next_action: 'Invented action' }, { next_review_at: at(7) }, { submission_request_id: id(99) }]) {
      expect(unsavedInputSchema.safeParse({ ...f.input, payload: { ...f.input.payload, ...extra } }).success).toBe(false);
    }
    expect(unsavedContextSchema.safeParse({ ...f.context, private_payload: {} }).success).toBe(false);
  });
  it.each(['prepared', 'cancelled'])('forbids receipt or ACK on %s', (state) => {
    const f = fixture(); expect(unsavedStateSchema.safeParse({ ...f.state, state }).success).toBe(false);
    expect(unsavedStateSchema.safeParse({ ...f.state, state, receipt: null, acknowledged_at: at(7) }).success).toBe(false);
    expect(unsavedStateSchema.safeParse({ ...f.state, state, receipt: null }).success).toBe(true);
  });
  it('requires an applied receipt and coherent audit/ACK times', () => {
    const f = fixture(); expect(unsavedStateSchema.safeParse({ ...f.state, receipt: null }).success).toBe(false);
    expect(unsavedStateSchema.safeParse({ ...f.state, acknowledged_at: at(1) }).success).toBe(false);
    expect(unsavedStateSchema.safeParse({ ...f.state, acknowledged_at: at(7) }).success).toBe(true);
    f.receipt.intent_cancelled_at = at(3); expect(unsavedStateSchema.safeParse(f.state).success).toBe(false);
  });
  it.each(['work_item_id', 'event_id', 'intent_id', 'recorded_at'])('rejects inconsistent history %s', (key) => {
    const f = fixture(); if (key === 'work_item_id') f.history.work_item_id = id(99);
    else Object.assign(f.history.items[0], { [key]: key === 'recorded_at' ? at(0) : id(99) });
    expect(unsavedHistoryPageSchema.safeParse(f.history).success).toBe(false);
  });
  it('history permits a different author without treating it as current-user evidence', () => {
    const f = fixture(); f.history.items[0].actor_id = id(99); expect(unsavedHistoryPageSchema.safeParse(f.history).success).toBe(true);
  });
  it('requires forward unique pages, exact full-page cursors and only pending private rows', () => {
    const f = fixture();
    for (const page of [{ items: [f.state, f.state], next_cursor: null }, { items: [f.state], next_cursor: id(10) },
      { items: [{ ...f.state, acknowledged_at: at(7) }], next_cursor: null },
      { items: [{ ...f.state, state: 'cancelled', receipt: null }], next_cursor: null }]) {
      expect(unsavedPendingPageSchema.safeParse(page).success).toBe(false);
    }
    const items = Array.from({ length: 25 }, (_, n) => ({ ...f.state, request_id: id(100 + n), receipt: { ...f.receipt, request_id: id(100 + n) } }));
    expect(unsavedPendingPageSchema.safeParse({ items, next_cursor: id(124) }).success).toBe(true);
    expect(unsavedPendingPageSchema.safeParse({ items: [...items].reverse(), next_cursor: null }).success).toBe(false);
    expect(unsavedHistoryPageSchema.safeParse({ ...f.history, items: [f.history.items[0], f.history.items[0]] }).success).toBe(false);
    expect(unsavedHistoryPageSchema.safeParse({ ...f.history, next_cursor: id(11) }).success).toBe(false);
  });
});
if (process.env.HEARTLAND_UNSAVED_PROOF_DIR) describe('real PostgreSQL administrative projections', () => {
  it('decodes all 51 projections after matching the eight current source hashes', () => {
    const dir = process.env.HEARTLAND_UNSAVED_PROOF_DIR!;
    const proof = JSON.parse(readFileSync(join(dir, 'completion.json'), 'utf8')) as { all_ok: boolean; source_sha256: Record<string, string> };
    expect(proof.all_ok).toBe(true); expect(Object.keys(proof.source_sha256)).toHaveLength(8);
    for (const [file, hash] of Object.entries(proof.source_sha256)) expect(createHash('sha256').update(readFileSync(file)).digest('hex'), file).toBe(hash);
    const counts = { CONTEXT: 0, STATE: 0, HISTORY: 0 }, schemas = { CONTEXT: unsavedContextSchema, STATE: unsavedStateSchema, HISTORY: unsavedHistoryPageSchema };
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.stdout'))) {
      for (const match of readFileSync(join(dir, file), 'utf8').matchAll(/^UNSAVED_(CONTEXT|STATE|HISTORY):(.*)$/gm)) {
        const kind = match[1] as keyof typeof counts, parsed = schemas[kind].safeParse(JSON.parse(match[2]));
        expect(parsed.success, `${file}: ${parsed.success ? '' : parsed.error.message}`).toBe(true); counts[kind]++;
      }
    }
    expect(counts).toEqual({ CONTEXT: 14, STATE: 36, HISTORY: 1 });
  });
});
