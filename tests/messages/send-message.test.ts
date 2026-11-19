import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '@/lib/messages/actions';
import { sendMessageSchema } from '@/lib/messages/schema';

const { authorize, rpc, revalidate } = vi.hoisted(() => ({
  authorize: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/lib/auth/authorization', () => ({ authorizeProviderForPatient: authorize }));
vi.mock('next/cache', () => ({ revalidatePath: revalidate }));
const actor = '83000000-0000-4000-8000-000000000001';
const patient = '83000000-0000-4000-8000-000000000002';
const receipt = '83000000-0000-4000-8000-000000000003';
const fields = {
  patientId: patient,
  actorId: actor,
  requestId: receipt,
  templateType: 'general',
  subject: 'Follow-up',
  body: 'Rehearsal',
};
function form(overrides: Partial<typeof fields> = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries({ ...fields, ...overrides })) body.set(key, value);
  return body;
}
beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue({ authorized: true, user: { id: actor }, supabase: { rpc } });
});
describe('provider portal message', () => {
  it.each(['dose_change', 'appointment', 'lab_order', 'general'])('accepts %s', (templateType) => {
    expect(sendMessageSchema.safeParse({ ...fields, templateType }).success).toBe(true);
  });
  it('validates fields and the current authenticated account before recording', async () => {
    expect(
      (await sendMessage(null, form({ templateType: 'other' }))).errors?.templateType,
    ).toBeDefined();
    expect((await sendMessage(null, form({ actorId: patient }))).error).toBeTruthy();
    authorize.mockResolvedValueOnce({ authorized: false, error: 'Not authenticated' });
    expect((await sendMessage(null, form())).error).toBe('Not authenticated');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('requires the matching database receipt before reporting success', async () => {
    rpc
      .mockResolvedValueOnce({ data: patient, error: null })
      .mockResolvedValueOnce({ data: receipt, error: null });
    expect((await sendMessage(null, form())).error).toBeTruthy();
    expect(revalidate).not.toHaveBeenCalled();
    expect(await sendMessage(null, form())).toEqual({ success: true, receipt });
    expect(rpc).toHaveBeenLastCalledWith('record_portal_message', {
      p_expected_actor: actor,
      p_patient_id: patient,
      p_request_id: receipt,
      p_template: 'general',
      p_subject: 'Follow-up',
      p_body: 'Rehearsal',
    });
  });
});
