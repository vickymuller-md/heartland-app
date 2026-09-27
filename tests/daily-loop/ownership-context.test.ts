import { beforeEach, describe, expect, it, vi } from 'vitest';
const { authorize, rpc } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize, authorizeProviderForPatient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/product-analytics/actions', () => ({ trackProductEvent: vi.fn() }));
import { loadTransferContext, loadDesignationContext } from '@/lib/daily-loop/ownership-context-actions';
import { assignWorkItem, designatePatientAccountable } from '@/lib/daily-loop/actions';
import { OWNERSHIP_CONTEXT_UNAVAILABLE, OWNERSHIP_WRITE_UNCONFIRMED } from '@/lib/daily-loop/ownership-context';
const id = (n: number) => `52000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const target = { id: id(4), name: 'Eligible synthetic recipient' };
const transfer = { work_item_id: id(1), patient_id: id(2), current_assignee: id(3), current_revision: '0',
  eligible: true, pending_recipient: null, targets: [target], next_cursor: null };
const designation = { organization_id: id(5), patient_id: id(2), current: target, targets: [target], next_cursor: null };
const transferInput = { workItemId: id(1), after: null };
const designationInput = { organizationId: id(5), patientId: id(2), after: null };
const offerInput = { workItemId: id(1), patientId: id(2), assigneeId: id(4) };
const saveInput = { organizationId: id(5), patientId: id(2), accountableId: id(4) };
beforeEach(() => { vi.resetAllMocks(); authorize.mockResolvedValue({ authorized: true, user: { id: id(3) }, supabase: { rpc } }); });
describe('eligible ownership reads', () => {
  it('uses current authenticated paginated transfer scope', async () => {
    rpc.mockResolvedValue({ data: transfer, error: null });
    expect(await loadTransferContext({ ...transferInput, after: id(9) })).toEqual({ data: transfer, error: null });
    expect(authorize).toHaveBeenCalledWith('provider');
    expect(rpc).toHaveBeenCalledWith('get_work_transfer_context', { p_work_item_id: id(1), p_after: id(9), p_limit: 25 });
  });
  it('uses an explicit organization rather than a first-row designation', async () => {
    rpc.mockResolvedValue({ data: designation, error: null });
    expect(await loadDesignationContext(designationInput)).toEqual({ data: designation, error: null });
    expect(rpc).toHaveBeenCalledWith('get_patient_designation_context', { p_organization_id: id(5), p_patient_id: id(2), p_after: null, p_limit: 25 });
  });
  it.each([
    { ...transfer, work_item_id: id(99) }, { ...transfer, targets: Array(26).fill(target) },
    { ...transfer, eligible: false }, { ...transfer, pending_recipient: id(4) }, { ...transfer, private_detail: 'not allowed' },
  ])('rejects inconsistent or overbroad transfer projection', async (data) => {
    rpc.mockResolvedValue({ data, error: null }); expect(await loadTransferContext(transferInput)).toEqual({ data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE });
  });
  it.each([{ ...designation, organization_id: id(99) }, { ...designation, patient_id: id(99) }, { ...designation, targets: Array(26).fill(target) }])(
    'rejects another designation scope or excessive page', async (data) => {
      rpc.mockResolvedValue({ data, error: null }); expect(await loadDesignationContext(designationInput)).toEqual({ data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE });
    });
  it('keeps unauthorized, failed and empty distinct', async () => {
    authorize.mockResolvedValueOnce({ authorized: false });
    expect(await loadTransferContext(transferInput)).toEqual({ data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE }); expect(rpc).not.toHaveBeenCalled();
    rpc.mockRejectedValueOnce(new Error('private transport failure'));
    expect(await loadDesignationContext(designationInput)).toEqual({ data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE });
    const empty = { ...designation, current: null, targets: [] };
    rpc.mockResolvedValueOnce({ data: empty, error: null });
    expect(await loadDesignationContext(designationInput)).toEqual({ data: empty, error: null });
  });
});
describe('legacy commands do not turn lost confirmation into claimed rollback', () => {
  it.each(['returned-error', 'thrown-error', 'invalid-response'])('offer %s is unconfirmed', async (failure) => {
    if (failure === 'thrown-error') rpc.mockRejectedValue(new Error('private network detail'));
    else rpc.mockResolvedValue({ data: failure === 'invalid-response' ? {} : null, error: failure === 'returned-error' ? { code: '', message: 'fetch failed', status: 0 } : null });
    expect(await assignWorkItem(offerInput)).toEqual({ success: false, error: OWNERSHIP_WRITE_UNCONFIRMED });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it.each(['returned-error', 'thrown-error', 'invalid-response'])('designation %s is unconfirmed', async (failure) => {
    if (failure === 'thrown-error') rpc.mockRejectedValue(new Error('private network detail'));
    else rpc.mockResolvedValue({ data: null, error: failure === 'returned-error' ? { code: '', message: 'fetch failed', status: 0 } : null });
    expect(await designatePatientAccountable(saveInput)).toEqual({ success: false, error: OWNERSHIP_WRITE_UNCONFIRMED });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('confirms only matching response shapes without adding bulk transfer offers', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: id(8), error: null });
    expect(await assignWorkItem(offerInput)).toEqual({ success: true });
    expect(await designatePatientAccountable(saveInput)).toEqual({ success: true });
    expect(rpc).toHaveBeenLastCalledWith('designate_patient_accountable', expect.objectContaining({ p_offer_open_items: false }));
  });
});
