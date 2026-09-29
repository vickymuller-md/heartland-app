import { describe, expect, it } from 'vitest';
import { careRequestPayloadSchema, careRequestStateSchema } from '@/lib/care-workflow/types';
const id = (n: number) => `59000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const payload = { kind: 'laboratory_order', source: 'external_documented', purpose: '  Documented request  ',
  evidence: '  Synthetic source unchanged  ', occurred_at: '2026-09-29T12:00:00.123456+00:00',
  next_review_at: '2026-10-01T13:00:00Z', analytes: ['potassium', 'creatinine'] };
const state = { request_id: id(1), actor_id: id(2), organization_id: id(3), patient_id: id(4), work_item_id: id(5),
  payload, state: 'prepared', recorded_at: '2026-09-29T13:00:00.654321+00:00', acknowledged_at: null, receipt: null };

describe('Recoverable care request contract', () => {
  it('validates without trimming or otherwise changing the frozen payload', () => {
    expect(careRequestStateSchema.parse(state)).toEqual(state);
    expect(JSON.stringify(careRequestStateSchema.parse(state).payload)).toBe(JSON.stringify(payload));
  });
  it.each(['2026-09-29T24:00:00Z', '2026-09-29T23:59:60Z', '2026-09-29T12:00:00',
    '2026-09-29T12:00:00.1234567Z', '2026-02-30T12:00:00Z'])('rejects noncontract timestamp %s', (occurred_at) => {
    expect(careRequestPayloadSchema.safeParse({ ...payload, occurred_at }).success).toBe(false);
  });
  it.each([[], ['potassium', 'potassium'], ['unexpected']])('rejects invalid laboratory analytes %j', (analytes) => {
    expect(careRequestPayloadSchema.safeParse({ ...payload, analytes }).success).toBe(false);
  });
  it('does not accept a receipt that attests acceptance or external transmission', () => {
    const receipt = { request_id: id(1), work_item_id: id(5), event_id: id(6), workflow_revision: '1', stage: 'requested',
      recorded_at: state.recorded_at, acceptance_recorded: false, external_transmission_confirmed: false };
    expect(careRequestStateSchema.safeParse({ ...state, state: 'applied', receipt }).success).toBe(true);
    expect(careRequestStateSchema.safeParse({ ...state, state: 'applied', receipt: { ...receipt, acceptance_recorded: true } }).success).toBe(false);
    expect(careRequestStateSchema.safeParse({ ...state, state: 'applied', receipt: { ...receipt, external_transmission_confirmed: true } }).success).toBe(false);
    expect(careRequestStateSchema.safeParse({ ...state, state: 'applied', receipt: { ...receipt, work_item_id: id(10) } }).success).toBe(false);
  });
  it('keeps cancelled/prepared distinct from applied and rejects extra fields', () => {
    expect(careRequestStateSchema.safeParse({ ...state, state: 'applied' }).success).toBe(false);
    expect(careRequestStateSchema.safeParse({ ...state, acknowledged_at: state.recorded_at }).success).toBe(false);
    expect(careRequestStateSchema.safeParse({ ...state, forged_actor: id(6) }).success).toBe(false);
  });
  it('accepts the canonical GUID domain of PostgreSQL without inferring authority from version bits', () => {
    const value = { ...state, request_id: '00000000-0000-0000-0000-000000000001',
      work_item_id: '00000000-0000-0000-0000-000000000002' };
    expect(careRequestStateSchema.parse(value)).toEqual(value);
    expect(careRequestStateSchema.safeParse({ ...value, request_id: 'not-a-guid' }).success).toBe(false);
  });
});
