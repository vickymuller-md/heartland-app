import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canChangeLabSource, canRegisterLabSource, getLabSourceContext, SOURCE_CONTEXT_UNAVAILABLE, validateSourceDraft, type LabSourceItem } from '@/lib/labs/source-context';

const id = (n: number) => `66000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { actor_id: id(1), organization_id: id(90), patient_id: id(11) };
const at = '2026-09-01T09:30:00.123456-04:00';
function item(n = 100): LabSourceItem {
  return { source_authority_organization_id: null, observation: { id: `${id(n)}:potassium`, patient_id: scope.patient_id,
    original_lab_result_id: id(n), analyte: 'potassium', root_id: null, version_id: null, revision: null, status: 'original',
    effective_lab_result_id: id(n), value: '4.6', collected_at: at, notes: null, lab_facility: null, evaluation_status: null } };
}
const registered = { source_authority_organization_id: scope.organization_id,
  observation: { ...item().observation, root_id: id(2100), version_id: id(3100), revision: '1' } };
function page(items = [item()], changes = {}) { return { ...scope, can_mutate: true, snapshot: 'a'.repeat(64), items, next_cursor: null, ...changes }; }
function database(...data: unknown[]) {
  const rpc = vi.fn(); data.forEach((value) => rpc.mockResolvedValueOnce({ data: value, error: null }));
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}
describe('authorized source context', () => {
  it('preserves the existing observation DTO and exposes only the authority organization wrapper', async () => {
    const db = database(page([item(), { ...registered, observation: { ...registered.observation, id: `${id(101)}:potassium`, original_lab_result_id: id(101), effective_lab_result_id: id(101) } }]));
    const result = await getLabSourceContext(db.client, scope);
    expect(result.items).toHaveLength(2); expect(result.items[0]).toEqual(item());
    expect(db.rpc).toHaveBeenCalledWith('get_lab_source_context', { p_organization_id: scope.organization_id, p_patient_id: scope.patient_id, p_after: null, p_snapshot: null });
  });
  it('reads250 plus tail under one complete signature', async () => {
    const first = Array.from({ length: 250 }, (_, n) => item(100 + n)); const last = item(350);
    const db = database(page(first, { next_cursor: first.at(-1)!.observation.id }), page([last]));
    expect((await getLabSourceContext(db.client, scope)).items).toEqual([...first, last]);
    expect(db.rpc).toHaveBeenNthCalledWith(2, 'get_lab_source_context', expect.objectContaining({ p_after: first.at(-1)!.observation.id, p_snapshot: 'a'.repeat(64) }));
  });
  it.each([{ actor_id: id(2) }, { patient_id: id(12) }, { organization_id: id(91) }, { snapshot: 'bad' }, { can_mutate: 1 },
    { items: [{ ...item(), source_authority_organization_id: id(90) }] }, { items: [{ ...registered, source_authority_organization_id: null }] },
    { items: [{ ...item(), observation: { ...item().observation, patient_id: id(12) } }] }, { items: [item(), item()] },
    { items: [item(101), item(100)] }, { next_cursor: item().observation.id }, { items: Array.from({ length: 251 }, (_, n) => item(100 + n)) },
    { private_actor: id(3) }])('rejects a malformed or mismatched context %#', async (changes) => {
    await expect(getLabSourceContext(database(page(undefined, changes)).client, scope)).rejects.toThrow(SOURCE_CONTEXT_UNAVAILABLE);
  });
  it.each(['signature', 'capability', 'actor', 'repeated-key', 'rpc-error', 'throw', 'null'])('discards the entire context after a late %s failure', async (kind) => {
    const first = Array.from({ length: 250 }, (_, n) => item(100 + n));
    const db = database(page(first, { next_cursor: first.at(-1)!.observation.id }));
    const tail = page([item(350)], kind === 'signature' ? { snapshot: 'b'.repeat(64) } : kind === 'capability' ? { can_mutate: false }
      : kind === 'actor' ? { actor_id: id(2) } : kind === 'repeated-key' ? { items: [first.at(-1)!] } : {});
    if (kind === 'throw') db.rpc.mockRejectedValueOnce(new Error('lost'));
    else db.rpc.mockResolvedValueOnce({ data: kind === 'null' ? null : tail, error: kind === 'rpc-error' ? { code: '40001' } : null });
    await expect(getLabSourceContext(db.client, scope)).rejects.toThrow(SOURCE_CONTEXT_UNAVAILABLE);
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });
  it('never sends invalid scope and does not treat directory membership as clinical authority', async () => {
    const db = database(); await expect(getLabSourceContext(db.client, { ...scope, actor_id: 'bad' })).rejects.toThrow(); expect(db.rpc).not.toHaveBeenCalled();
    const context = { ...scope, can_mutate: true, items: [item()] };
    expect(canChangeLabSource(context, item())).toBe(true);
    expect(canChangeLabSource(context, registered)).toBe(true);
    expect(canChangeLabSource({ ...context, can_mutate: false }, item())).toBe(false);
    expect(canChangeLabSource(context, { ...registered, source_authority_organization_id: id(91) })).toBe(false);
    expect(canChangeLabSource(context, { ...item(), observation: { ...item().observation, patient_id: id(12) } })).toBe(false);
  });
});

const input = { ...scope, request_id: id(1100), root_id: id(2100), original_lab_result_id: id(100), analyte: 'potassium',
  command: 'correct_source', expected_revision: '1', payload: { value: '04.6000', collected_at: at, occurred_at: at, evidence: '  Source  ', reason: '  Correction  ' } };
const now = Date.parse('2026-09-01T14:00:00Z');
describe('new draft storage validation, not a clinical interval', () => {
  it('validates registration sources before allocating a request, without a clinical recency cutoff', () => {
    expect(canRegisterLabSource(item(), now)).toBe(true);
    expect(canRegisterLabSource(registered, now)).toBe(false);
    for (const change of [{ collected_at: '2026-09-01T14:00:00.000001Z' }, { value: '-1' }, { value: 'NaN' }]) {
      expect(canRegisterLabSource({ ...item(), observation: { ...item().observation, ...change } }, now)).toBe(false);
    }
    expect(canRegisterLabSource({ ...item(), observation: { ...item().observation, collected_at: '2000-01-01T00:00:00Z' } }, now)).toBe(true);
  });
  it.each([['potassium', '4.60'], ['creatinine', '1.230'], ['egfr', '00065.00'], ['bun', '50.0'], ['bnp', '123.40'],
    ['nt_probnp', '1234.5'], ['hba1c', '6.5'], ['glucose', '105.0'], ['sodium', '140.0'], ['hemoglobin', '13.1'],
    ['ferritin', '125.4'], ['tsat', '25.0'], ['ldl', '100.5']])('preserves exact %s decimal and microsecond spelling', (analyte, value) => {
    const draft = { ...input, analyte, payload: { ...input.payload, value } }; expect(validateSourceDraft(draft, now)).toEqual(draft);
  });
  it.each([['potassium', '4.61'], ['creatinine', '1.231'], ['egfr', '65.1'], ['egfr', '2147483648'], ['bnp', '1000000'],
    ['nt_probnp', '10000000'], ['glucose', '10000'], ['sodium', '1000'], ['potassium', '-1'], ['potassium', '1e1'], ['potassium', 'NaN']])('refuses %s precision/format overflow %s without rounding', (analyte, value) => {
    expect(validateSourceDraft({ ...input, analyte, payload: { ...input.payload, value } }, now)).toBeNull();
  });
  it('checks the microsecond beyond now without rewriting historical timezones', () => {
    const future = '2026-09-01T14:00:00.000001Z';
    for (const field of ['collected_at', 'occurred_at']) expect(validateSourceDraft({ ...input, payload: { ...input.payload, [field]: future } }, now)).toBeNull();
    expect(validateSourceDraft(input, NaN)).toBeNull();
    expect(validateSourceDraft({ ...input, payload: { ...input.payload, occurred_at: '2026-09-01T13:00:00' } }, now)).toBeNull();
  });
  it('validates registration and cancellation without inventing a corrected value', () => {
    const register = { ...input, command: 'register_source', expected_revision: '0', payload: { evidence: 'Source', occurred_at: at } };
    expect(validateSourceDraft(register, now)).toEqual(register);
    const cancel = { ...input, command: 'cancel_source', payload: { evidence: 'Source', occurred_at: at, reason: 'Invalid source' } };
    expect(validateSourceDraft(cancel, now)).toEqual(cancel);
  });
});
