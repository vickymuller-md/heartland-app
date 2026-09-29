import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { effectiveLabObservationSchema, getEffectiveLabObservations, selectLatestEffectiveLab,
  EFFECTIVE_LABS_UNAVAILABLE, type EffectiveLabObservation } from '@/lib/labs/effective';

const id = (n: number) => `62000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1); const patient = id(11); const other = id(12); const signature = 'a'.repeat(64);
const at = '2026-09-29T12:00:00.123456Z'; const now = new Date('2026-09-29T13:00:00Z');
function observation(n = 100, changes: Partial<EffectiveLabObservation> = {}): EffectiveLabObservation {
  return { id: `${id(n)}:potassium`, original_lab_result_id: id(n), patient_id: patient, analyte: 'potassium',
    root_id: null, version_id: null, revision: null, status: 'original', effective_lab_result_id: id(n),
    value: '4.6', collected_at: at, notes: '  Original source_document  ', lab_facility: null, evaluation_status: null, ...changes };
}
function page(items = [observation()], changes: Record<string, unknown> = {}) {
  return { actor_id: actor, patient_ids: [patient], snapshot: signature, items, next_cursor: null, ...changes };
}
function database(...responses: unknown[]) {
  const rpc = vi.fn(); responses.forEach((data) => rpc.mockResolvedValueOnce({ data, error: null }));
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}
const corrected = observation(100, { root_id: id(2100), version_id: id(3101), revision: '2', status: 'corrected',
  effective_lab_result_id: id(201), value: '4.8', evaluation_status: 'pending' });
const cancelled = observation(100, { root_id: id(2100), version_id: id(3102), revision: '3', status: 'cancelled',
  effective_lab_result_id: null, value: null });

describe('effective observation projection contract', () => {
  it('keeps exact decimal text, microseconds, metadata and unregistered identity', async () => {
    const item = observation(100, { value: '9007199254740993.123456789' });
    const db = database(page([item]));
    expect(await getEffectiveLabObservations(db.client, [patient], actor)).toEqual([item]);
    expect(db.rpc).toHaveBeenCalledWith('get_effective_lab_observations', { p_patient_ids: [patient], p_after: null, p_snapshot: null });
  });
  it('decodes registration without changing status/value or inventing review', () => {
    const item = observation(100, { root_id: id(2100), version_id: id(3100), revision: '1' });
    expect(effectiveLabObservationSchema.parse(item)).toEqual(item);
  });
  it('describes corrected and cancelled DTOs without claiming the mutation API exists', () => {
    expect(effectiveLabObservationSchema.parse(corrected)).toEqual(corrected);
    expect(effectiveLabObservationSchema.parse(cancelled)).toEqual(cancelled);
  });
  it.each([{ id: `${id(999)}:potassium` }, { root_id: id(2100) }, { revision: '1' }, { version_id: id(3100) },
    { status: 'corrected' }, { value: null }, { effective_lab_result_id: null }, { effective_lab_result_id: id(999) },
    { value: 4.6 }, { value: 'NaN' }, { value: 'Infinity' }, { value: '1e3' }, { value: '' },
    { collected_at: 'infinity' }, { collected_at: '2026-02-30T00:00:00Z' }, { collected_at: '2026-09-29T12:00:00.1234567Z' },
    { payload: {} }, { organization_id: id(90) }, { source_fingerprint: signature }, { clinical_review_recorded: true }])(
    'rejects malformed or private observation data %#', (changes) => {
      expect(effectiveLabObservationSchema.safeParse({ ...observation(), ...changes }).success).toBe(false);
    });
  it.each([{ revision: '1' }, { revision: '0' }, { revision: '9223372036854775808' }, { revision: 2 },
    { effective_lab_result_id: id(100) }, { root_id: null }])('rejects inconsistent corrected version %#', (changes) => {
    expect(effectiveLabObservationSchema.safeParse({ ...corrected, ...changes }).success).toBe(false);
  });
  it.each([{ value: '4.6' }, { effective_lab_result_id: id(201) }, { evaluation_status: 'recorded' }])('rejects cancellation with a current value/status %#', (changes) => {
    expect(effectiveLabObservationSchema.safeParse({ ...cancelled, ...changes }).success).toBe(false);
  });
  it('reads250 plus tail with the same scope, signature and explicit cursor', async () => {
    const first = Array.from({ length: 250 }, (_, n) => observation(n + 100)); const last = observation(350);
    const db = database(page(first, { next_cursor: first.at(-1)!.id }), page([last]));
    expect(await getEffectiveLabObservations(db.client, [patient, patient], actor)).toEqual([...first, last]);
    expect(db.rpc).toHaveBeenNthCalledWith(2, 'get_effective_lab_observations', {
      p_patient_ids: [patient], p_after: first.at(-1)!.id, p_snapshot: signature,
    });
  });
  it.each([{ actor_id: id(2) }, { patient_ids: [other] }, { patient_ids: [patient, patient] }, { snapshot: 'bad' },
    { next_cursor: `${id(100)}:potassium` }, { items: [observation(), observation()] },
    { items: [observation(101), observation(100)] }, { items: [observation(100, { patient_id: other })] },
    { items: Array.from({ length: 251 }, (_, n) => observation(n + 100)) }])('rejects malformed or wrong-scope page %#', async (change) => {
    const db = database(page(undefined, change));
    await expect(getEffectiveLabObservations(db.client, [patient], actor)).rejects.toThrow(EFFECTIVE_LABS_UNAVAILABLE);
  });
  it.each(['changed-signature', 'repeated-key', 'wrong-actor', 'invalid-source', 'query-error', 'throw'])('discards all accumulated rows on second-page %s', async (failure) => {
    const first = Array.from({ length: 250 }, (_, n) => observation(n + 100));
    const db = database(page(first, { next_cursor: first.at(-1)!.id }));
    const data = page([observation(350)]);
    if (failure === 'changed-signature') data.snapshot = 'b'.repeat(64);
    if (failure === 'repeated-key') data.items = [first.at(-1)!];
    if (failure === 'wrong-actor') data.actor_id = id(2);
    if (failure === 'invalid-source') data.items = [observation(350, { value: 'NaN' })];
    if (failure === 'throw') db.rpc.mockRejectedValueOnce(new Error('Network interrupted'));
    else db.rpc.mockResolvedValueOnce({ data, error: failure === 'query-error' ? { code: '40001' } : null });
    await expect(getEffectiveLabObservations(db.client, [patient], actor)).rejects.toThrow(EFFECTIVE_LABS_UNAVAILABLE);
    expect(db.rpc).toHaveBeenCalledTimes(2); // no invisible restart/fallback
  });
  it('normalizes a deduplicated scope before sending, requires valid IDs even for empty reads', async () => {
    const db = database(page([], { patient_ids: [patient, other] }));
    expect(await getEffectiveLabObservations(db.client, [other, patient, patient], actor)).toEqual([]);
    expect(db.rpc).toHaveBeenCalledWith('get_effective_lab_observations', expect.objectContaining({ p_patient_ids: [patient, other] }));
    expect(await getEffectiveLabObservations(db.client, [], actor)).toEqual([]);
    await expect(getEffectiveLabObservations(db.client, [], 'bad')).rejects.toThrow(EFFECTIVE_LABS_UNAVAILABLE);
    await expect(getEffectiveLabObservations(db.client, ['bad'], actor)).rejects.toThrow(EFFECTIVE_LABS_UNAVAILABLE);
  });
});

describe('latest source selection never revives superseded evidence', () => {
  const old = observation(90, { collected_at: '2026-09-28T12:00:00Z', value: '4.1' });
  it('selects by patient/analyte, not newest whole panel', () => {
    const unrelated = observation(101, { patient_id: other, collected_at: '2026-09-29T12:30:00Z' });
    expect(selectLatestEffectiveLab([old, unrelated], patient, 'potassium', now).observation).toEqual(old);
    expect(selectLatestEffectiveLab([old], patient, 'creatinine', now).state).toBe('missing');
  });
  it('preserves a cancellation tombstone instead of substituting an earlier result', () => {
    expect(selectLatestEffectiveLab([old, cancelled], patient, 'potassium', now)).toMatchObject({ state: 'cancelled', observation: cancelled });
  });
  it('does not choose a same-time active observation over cancellation evidence', () => {
    expect(selectLatestEffectiveLab([observation(50), cancelled], patient, 'potassium', now).state).toBe('cancelled');
  });
  it.each([{ value: '-1' }, { value: 'NaN' }, { value: null }, { collected_at: '2026-09-30T12:00:00Z' },
    { collected_at: 'invalid' }])('keeps invalid source visible, never silently chooses old valid value %#', (changes) => {
    const current = observation(100, changes);
    expect(selectLatestEffectiveLab([old, current], patient, 'potassium', now)).toMatchObject({ state: 'invalid', observation: current });
  });
  it('preserves collection microseconds when choosing latest', () => {
    const later = observation(80, { collected_at: '2026-09-29T12:00:00.123457Z' });
    expect(selectLatestEffectiveLab([observation(), later], patient, 'potassium', now).observation).toEqual(later);
  });
  it('detects same-time differences without rounding decimal text through Number', () => {
    const first = observation(100, { value: '4.6000000000000001' });
    const second = observation(101, { value: '4.6000000000000002' });
    expect(selectLatestEffectiveLab([first, second], patient, 'potassium', now).state).toBe('invalid');
    expect(selectLatestEffectiveLab([observation(100), observation(101, { value: '04.6000' })], patient, 'potassium', now).state).toBe('available');
  });
  it('uses documented corrected collection, not a version processing time', () => {
    expect(selectLatestEffectiveLab([old, corrected], patient, 'potassium', now)).toMatchObject({ state: 'available', observation: corrected });
    expect(selectLatestEffectiveLab([old, corrected], patient, 'potassium', now).reason).toMatch(/not assessed/);
    expect(() => selectLatestEffectiveLab([], patient, 'potassium', new Date('invalid'))).toThrow();
  });
  it('validates decimal sign and equality without numeric overflow or underflow', () => {
    const huge = observation(100, { value: '1' + '0'.repeat(309) });
    expect(selectLatestEffectiveLab([huge], patient, 'potassium', now).state).toBe('available');
    const tinyNegative = observation(100, { value: '-0.' + '0'.repeat(400) + '1' });
    expect(selectLatestEffectiveLab([old, tinyNegative], patient, 'potassium', now).state).toBe('invalid');
    expect(selectLatestEffectiveLab([observation(100, { value: '-0.000' }), observation(101, { value: '0' })], patient, 'potassium', now).state).toBe('available');
  });
});
