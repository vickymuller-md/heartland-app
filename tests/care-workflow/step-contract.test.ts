import { describe, expect, it } from 'vitest';
import { careStepCommandSchema, careStepStateSchema } from '@/lib/care-workflow/step-types';
const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const payload = { occurred_at: '2026-09-29T12:00:00.123456Z', evidence: '  Synthetic evidence  ', next_action: 'Explicit follow-up',
  next_review_at: '2026-09-29T12:00:00.654321Z', details: {} };
const state = { request_id: id(1), work_item_id: id(2), actor_id: id(3), organization_id: id(4), patient_id: id(5),
  expected_revision: '9007199254740993', expected_ownership_revision: '9007199254740994',
  command: 'record_collection', payload, state: 'prepared', recorded_at: payload.occurred_at, acknowledged_at: null, receipt: null };
const receipt = { request_id: id(1), work_item_id: id(2), event_id: id(6), workflow_revision: '9007199254740994',
  ownership_revision: '9007199254740994', stage: 'collected', exception_id: null, due_at: payload.next_review_at,
  recorded_at: payload.occurred_at, clinical_review_recorded: false, communication_confirmed: false, care_completed: false };
describe('operational care step receipt contract', () => {
  it('preserves exact historical text, microseconds and bigint strings without enforcing fresh deadlines', () => {
    expect(careStepStateSchema.parse(state)).toEqual(state);
    const applied = { ...state, state: 'applied', receipt };
    expect(careStepStateSchema.parse(applied)).toEqual(applied);
  });
  it.each([{ request_id: id(9) }, { work_item_id: id(9) }, { workflow_revision: '9007199254740993' },
    { ownership_revision: '1' }, { workflow_revision: 'bad' }, { workflow_revision: '1.5' },
    { care_completed: true }, { clinical_review_recorded: true }, { communication_confirmed: true }])(
    'rejects mismatched or overclaiming receipt %#', (change) => {
      expect(careStepStateSchema.safeParse({ ...state, state: 'applied', receipt: { ...receipt, ...change } }).success).toBe(false);
    });
  it.each(['0', '-1', '1.5', '9223372036854775807', 'bad'])('rejects invalid expected revision %s', (expected_revision) => {
    expect(careStepStateSchema.safeParse({ ...state, expected_revision }).success).toBe(false);
    expect(careStepStateSchema.safeParse({ ...state, expected_revision, state: 'applied', receipt }).success).toBe(false);
  });
  it('rejects changed payload keys and clinical commands not implemented by this contract', () => {
    expect(careStepCommandSchema.safeParse({ command: 'record_collection', payload: { ...payload, details: { actor: id(1) } } }).success).toBe(false);
    expect(careStepCommandSchema.safeParse({ command: 'record_review', payload }).success).toBe(false);
    expect(careStepCommandSchema.safeParse({ command: 'close_success', payload }).success).toBe(false);
  });
  it.each(['approved', 'denied', 'pending', 'other'])('preserves %s assistance response without inferring acquisition', (outcome) => {
    const value = { command: 'record_assistance_response', payload: { ...payload, details: { outcome, response_reference: 'Synthetic letter' } } };
    expect(careStepCommandSchema.parse(value)).toEqual(value);
  });
  it('requires acquisition source, not a transport/approval flag', () => {
    for (const source of ['patient_report', 'professional_verification']) {
      expect(careStepCommandSchema.safeParse({ command: 'record_obtained', payload: { ...payload, details: { source } } }).success).toBe(true);
    }
    expect(careStepCommandSchema.safeParse({ command: 'record_obtained', payload: { ...payload, details: { source: 'approval' } } }).success).toBe(false);
  });
  it('keeps a civil appointment date distinct from optional zoned instant', () => {
    const value = { command: 'record_schedule', payload: { ...payload, details: { appointment_date: '2026-11-01', appointment_at: null, appointment_timezone: null } } };
    expect(careStepCommandSchema.parse(value)).toEqual(value);
    expect(careStepCommandSchema.safeParse({ ...value, payload: { ...payload, details: { ...value.payload.details, appointment_at: '2026-11-01T01:30:00-04:00' } } }).success).toBe(false);
    expect(careStepCommandSchema.safeParse({ ...value, payload: { ...payload, details: { ...value.payload.details, appointment_date: '2026-02-30' } } }).success).toBe(false);
  });
  it('requires a distinct identity and meaningful text for each exception', () => {
    expect(careStepCommandSchema.safeParse({ command: 'record_exception', payload: { ...payload,
      details: { exception_id: id(8), code: 'report_missing', reason: 'Documented synthetic absence' } } }).success).toBe(true);
    expect(careStepCommandSchema.safeParse({ command: 'record_exception', payload: { ...payload,
      details: { exception_id: id(8), code: 'report_missing', reason: '  ' } } }).success).toBe(false);
  });
  it('rejects a wrong resulting stage or an unrelated exception identity', () => {
    expect(careStepStateSchema.safeParse({ ...state, state: 'applied', receipt: { ...receipt, stage: 'obtained' } }).success).toBe(false);
    expect(careStepStateSchema.safeParse({ ...state, state: 'applied', receipt: { ...receipt, exception_id: id(99) } }).success).toBe(false);
  });
  it('matches GUID identity case-insensitively without rewriting the frozen exception payload', () => {
    const exceptionId = 'ABCDEFAB-CDEF-ABCD-EFAB-ABCDEFABCDEF';
    const value = { ...state, command: 'record_exception', state: 'applied', payload: { ...payload,
      details: { exception_id: exceptionId, code: 'other', reason: 'Synthetic source preserved' } },
      receipt: { ...receipt, exception_id: exceptionId.toLowerCase() } };
    expect(careStepStateSchema.parse(value)).toEqual(value);
  });
});
