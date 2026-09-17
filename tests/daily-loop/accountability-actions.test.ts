/**
 * Patient accountability, transfer and documented-closure actions.
 *
 * Contract: dissemination/ecosystem_update/O4_DESENHO_00040_RESPONSABILIDADE_TEACHBACK
 * sections 3-4 (single accountable provider, accept/decline transfer, reassignment through
 * an RPC, documented closure with `outcome_code`). Supabase is mocked: these tests pin the
 * RPC names and parameter names the App sends, and the outcome-code rule for legacy rows.
 * All ids are synthetic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/product-analytics/actions', () => ({ trackProductEvent: vi.fn() }));

const mockAuthorize = vi.fn();
vi.mock('@/lib/auth/authorization', () => ({
  authorize: (...args: unknown[]) => mockAuthorize(...args),
  authorizeProviderForPatient: vi.fn(),
}));

import {
  acceptTransfer,
  acceptWorkItem,
  assignWorkItem,
  declineTransfer,
  designatePatientAccountable,
  reassignWorkItem,
  transitionWorkItem,
} from '@/lib/daily-loop/actions';

const WORK_ITEM_ID = '00000000-0000-4000-a000-000000000001';
const PATIENT_ID = '00000000-0000-4000-a000-000000000002';
const ASSIGNEE_ID = '00000000-0000-4000-a000-000000000003';
const ORGANIZATION_ID = '00000000-0000-4000-a000-000000000004';
const ACTOR_ID = '00000000-0000-4000-a000-000000000005';

const mockRpc = vi.fn();
const mockMaybeSingle = vi.fn();
const mockUpdateResult = vi.fn();
const updates: Array<Record<string, unknown>> = [];

interface Chain {
  eq: () => Chain;
  maybeSingle: typeof mockMaybeSingle;
  select: () => unknown;
}

const mockFrom = vi.fn(() => ({
  select: () => {
    const chain = {
      eq: () => chain,
      maybeSingle: mockMaybeSingle,
      select: () => mockUpdateResult(),
    } as Chain;
    return chain;
  },
  update: (payload: Record<string, unknown>) => {
    updates.push(payload);
    const chain = {
      eq: () => chain,
      maybeSingle: mockMaybeSingle,
      select: () => mockUpdateResult(),
    } as Chain;
    return chain;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  mockAuthorize.mockResolvedValue({
    authorized: true,
    user: { id: ACTOR_ID },
    role: 'provider',
    supabase: { rpc: mockRpc, from: mockFrom },
  });
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockUpdateResult.mockResolvedValue({ data: [{ id: WORK_ITEM_ID }], error: null });
  mockMaybeSingle.mockResolvedValue({ data: { accountability_source: 'designated' }, error: null });
});

describe('transfer offers replace the direct assigned_to update', () => {
  it('offers the transfer through offer_work_item_transfer instead of writing assigned_to', async () => {
    const result = await assignWorkItem({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      assigneeId: ASSIGNEE_ID,
    });

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith('offer_work_item_transfer', {
      p_work_item_id: WORK_ITEM_ID,
      p_to: ASSIGNEE_ID,
      p_note: null,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('reports a failed offer without claiming the work moved', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'another transfer is already pending' } });

    const result = await assignWorkItem({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      assigneeId: ASSIGNEE_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('This transfer could not be offered.');
  });
});

describe('forced reassignment by a manager', () => {
  it('calls reassign_work_item with the documented reason', async () => {
    const result = await reassignWorkItem({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      assigneeId: ASSIGNEE_ID,
      reason: 'Owner on unplanned leave',
    });

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith('reassign_work_item', {
      p_work_item_id: WORK_ITEM_ID,
      p_to: ASSIGNEE_ID,
      p_reason: 'Owner on unplanned leave',
    });
  });

  it('refuses a reassignment without a reason', async () => {
    const result = await reassignWorkItem({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      assigneeId: ASSIGNEE_ID,
      reason: 'x',
    });

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('documented closure', () => {
  it('requires an outcome code for items in the single-accountable model', async () => {
    const result = await transitionWorkItem({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      status: 'closed',
      outcome: 'Patient seen in clinic and volume status reassessed',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Choose a documented outcome code to close this item');
    expect(updates).toHaveLength(0);
  });

  it('sends outcome_code alongside the outcome text when closing', async () => {
    const result = await transitionWorkItem({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      status: 'closed',
      outcome: 'Diuretic increased and follow-up scheduled',
      outcomeCode: 'clinical_action_taken',
    });

    expect(result).toEqual({ success: true });
    expect(updates[0]).toEqual({
      status: 'closed',
      outcome: 'Diuretic increased and follow-up scheduled',
      outcome_code: 'clinical_action_taken',
    });
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('still closes legacy items that have no accountability source', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { accountability_source: null }, error: null });

    const result = await transitionWorkItem({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      status: 'closed',
      outcome: 'Duplicate of the item closed yesterday',
    });

    expect(result).toEqual({ success: true });
    expect(updates[0]).toEqual({
      status: 'closed',
      outcome: 'Duplicate of the item closed yesterday',
    });
  });

  it('rejects an outcome code outside the human-selectable set', async () => {
    const result = await transitionWorkItem({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      status: 'closed',
      outcome: 'Closed by the grace-period path',
      // Written by the database only.
      outcomeCode: 'outcome_not_recorded' as 'no_action_needed',
    });

    expect(result.success).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe('acceptance and decline', () => {
  it('accepts the item assigned to the current provider', async () => {
    const result = await acceptWorkItem({ workItemId: WORK_ITEM_ID, patientId: PATIENT_ID });

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith('accept_work_item', { p_work_item_id: WORK_ITEM_ID });
  });

  it('accepts a pending transfer as the addressee', async () => {
    const result = await acceptTransfer({ workItemId: WORK_ITEM_ID, patientId: PATIENT_ID });

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith('accept_work_item_transfer', {
      p_work_item_id: WORK_ITEM_ID,
    });
  });

  it('surfaces a lost race on acceptance instead of reporting success', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Transfer acceptance not authorized' },
    });

    const result = await acceptTransfer({ workItemId: WORK_ITEM_ID, patientId: PATIENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe('This transfer could not be accepted.');
  });

  it('declines a transfer with a reason on record', async () => {
    const result = await declineTransfer({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      reason: 'Patient is not on my panel this week',
    });

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith('decline_work_item_transfer', {
      p_work_item_id: WORK_ITEM_ID,
      p_reason: 'Patient is not on my panel this week',
    });
  });

  it('refuses a decline without a reason', async () => {
    const result = await declineTransfer({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      reason: '  ',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Declining a transfer requires a reason.');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('manager designation', () => {
  it('designates the accountable provider without moving open work', async () => {
    const result = await designatePatientAccountable({
      organizationId: ORGANIZATION_ID,
      patientId: PATIENT_ID,
      accountableId: ASSIGNEE_ID,
    });

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith('designate_patient_accountable', {
      p_organization_id: ORGANIZATION_ID,
      p_patient_id: PATIENT_ID,
      p_accountable_id: ASSIGNEE_ID,
      p_note: null,
      p_offer_open_items: false,
    });
  });

  it('reports a rejected designation', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not a manager' } });

    const result = await designatePatientAccountable({
      organizationId: ORGANIZATION_ID,
      patientId: PATIENT_ID,
      accountableId: ASSIGNEE_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('The accountable provider could not be designated.');
  });

  it('refuses an unauthenticated caller', async () => {
    mockAuthorize.mockResolvedValue({ authorized: false, error: 'MFA required' });

    const result = await designatePatientAccountable({
      organizationId: ORGANIZATION_ID,
      patientId: PATIENT_ID,
      accountableId: ASSIGNEE_ID,
    });

    expect(result).toEqual({ success: false, error: 'MFA required' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
