import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markMessageRead } from '@/lib/messages/actions';

const { authorize, rpc, revalidate } = vi.hoisted(() => ({
  authorize: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
vi.mock('next/cache', () => ({ revalidatePath: revalidate }));
const patient = '83000000-0000-4000-8000-000000000001';
const message = '83000000-0000-4000-8000-000000000002';
beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue({ authorized: true, user: { id: patient }, supabase: { rpc } });
});

describe('portal read confirmation', () => {
  it('requires the same patient session that opened the card', async () => {
    expect((await markMessageRead(message, message)).success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('requires a timestamp from the database before refreshing both views', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: '2026-11-19T13:00:00Z', error: null });
    expect((await markMessageRead(message, patient)).success).toBe(false);
    expect(revalidate).not.toHaveBeenCalled();
    expect(await markMessageRead(message, patient)).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith('confirm_portal_message_read', {
      p_expected_patient: patient,
      p_message_id: message,
    });
    expect(revalidate).toHaveBeenCalledWith('/today');
    expect(revalidate).toHaveBeenCalledWith('/patients/' + patient);
  });
});
