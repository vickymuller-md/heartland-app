// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, abortSignal } = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc } }));
import { GET, maxDuration } from '@/app/api/notification-maintenance/route';
const request = (auth = 'Bearer synthetic-secret') => new Request(
  'https://app.example.test/api/notification-maintenance?limit=10000&erase=all', { headers: { authorization: auth } },
);
const complete = { status: 'complete', scanned: 4, erased: 1, retained: 3, receiptsExpired: 0 };
beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'synthetic-secret');
  vi.stubEnv('NOTIFICATION_RETENTION_ENABLED', 'true');
  rpc.mockReturnValue({ abortSignal });
  abortSignal.mockResolvedValue({ data: complete, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('synthetic notification maintenance', () => {
  it('uses a fixed bounded batch and returns aggregate counts only', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual(complete);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('maintain_synthetic_notifications', { p_limit: 10 });
    expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal); expect(maxDuration).toBe(30);
  });
  it.each(['', 'false', 'TRUE'])('does not load the service when disabled (%s)', async (value) => {
    vi.stubEnv('NOTIFICATION_RETENTION_ENABLED', value);
    expect((await GET(request())).status).toBe(503); expect(rpc).not.toHaveBeenCalled();
  });
  it('requires configuration', async () => {
    vi.stubEnv('CRON_SECRET', ''); expect((await GET(request())).status).toBe(503); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['', 'Bearer wrong', 'synthetic-secret'])('requires exact authorization', async (auth) => {
    expect((await GET(request(auth))).status).toBe(401); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([null, {}, { status: 'busy' }, { ...complete, scanned: 1000 }, { ...complete, erased: -1 },
    { ...complete, retained: 0 }, { ...complete, endpoint: 'private' }])('fails closed on malformed or incomplete responses', async (data) => {
    abortSignal.mockResolvedValue({ data, error: null });
    const response = await GET(request()); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Notification maintenance is unavailable' });
  });
  it('does not confuse no eligible scopes with a database failure', async () => {
    abortSignal.mockResolvedValue({ data: { status: 'complete', scanned: 0, erased: 0, retained: 0, receiptsExpired: 0 }, error: null });
    expect((await GET(request())).status).toBe(200);
    abortSignal.mockResolvedValue({ data: complete, error: { message: 'PRIVATE DATABASE DETAIL' } });
    const response = await GET(request()); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('PRIVATE');
  });
  it('sanitizes timeout and thrown faults', async () => {
    abortSignal.mockRejectedValue(new Error('PRIVATE TOKEN'));
    const response = await GET(request()); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Notification maintenance is unavailable' });
  });
});
