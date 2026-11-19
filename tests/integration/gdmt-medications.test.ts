// INTG-05: GDMT selections optionally add to patient medication list
// Key: deduplication check required before INSERT
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { buildGdmtMedications } from '@/lib/integration/utils';
import { saveGdmtMedications } from '@/lib/integration/actions';
import type { GdmtMedicationInput } from '@/lib/integration/types';

const { authorize, rpc, revalidate } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorizeProviderForPatient: authorize }));
vi.mock('next/cache', () => ({ revalidatePath: revalidate }));

describe('buildGdmtMedications (INTG-05)', () => {
  const selected: GdmtMedicationInput[] = [
    { name: 'Lisinopril', dosage: '5mg', frequency: 'daily' },
    { name: 'Metoprolol Succinate', dosage: '25mg', frequency: 'daily' },
    { name: 'Spironolactone', dosage: '25mg', frequency: 'daily' },
    { name: 'Empagliflozin', dosage: '10mg', frequency: 'daily' },
  ];

  it('returns all medications when none exist already', () => {
    const result = buildGdmtMedications(selected, []);
    expect(result).toHaveLength(4);
    expect(result.map(m => m.name)).toEqual([
      'Lisinopril', 'Metoprolol Succinate', 'Spironolactone', 'Empagliflozin',
    ]);
  });

  it('filters out drugs already in the existing medication list (deduplication)', () => {
    const existing = ['Lisinopril', 'Spironolactone'];
    const result = buildGdmtMedications(selected, existing);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.name)).toEqual(['Metoprolol Succinate', 'Empagliflozin']);
  });

  it('deduplication is case-insensitive', () => {
    const existing = ['lisinopril', 'SPIRONOLACTONE'];
    const result = buildGdmtMedications(selected, existing);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.name)).toEqual(['Metoprolol Succinate', 'Empagliflozin']);
  });

  it('returns empty array when all selected drugs already exist', () => {
    const existing = ['Lisinopril', 'Metoprolol Succinate', 'Spironolactone', 'Empagliflozin'];
    const result = buildGdmtMedications(selected, existing);
    expect(result).toHaveLength(0);
  });

  it('trims whitespace during comparison', () => {
    const existing = ['  Lisinopril  ', 'Spironolactone '];
    const result = buildGdmtMedications(selected, existing);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.name)).toEqual(['Metoprolol Succinate', 'Empagliflozin']);
  });
});

describe('saving confirmed GDMT selections', () => {
  const actor = '80000000-0000-4000-8000-000000000001';
  const patient = '80000000-0000-4000-8000-000000000002';
  const item = { request_id: '80000000-0000-4000-8000-000000000003', name: 'Confirmed item', dosage: 'Recorded dose', frequency: 'once_daily' };
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ authorized: true, user: { id: actor }, supabase: { rpc } });
  });
  it('binds selections to the provider session, patient, and request receipt', async () => {
    rpc.mockResolvedValue({ data: { added: 0, existing: 1 }, error: null });
    expect(await saveGdmtMedications(patient, [item], actor)).toEqual({ success: true, added: 0, existing: 1 });
    expect(rpc).toHaveBeenCalledWith('record_gdmt_medications', { p_actor: actor, p_patient: patient, p_selections: [item] });
    expect(revalidate).toHaveBeenCalledWith('/medications');
  });
  it('rejects a switched session and unresolved catalog alternatives before a write', async () => {
    expect((await saveGdmtMedications(patient, [item], patient)).success).toBe(false);
    expect((await saveGdmtMedications(patient, [{ ...item, name: 'One or another' }], actor)).success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects a partial receipt and preserves the opportunity to retry', async () => {
    rpc.mockResolvedValue({ data: { added: 0, existing: 0 }, error: null });
    expect((await saveGdmtMedications(patient, [item], actor)).success).toBe(false);
    expect(revalidate).not.toHaveBeenCalled();
  });
});
