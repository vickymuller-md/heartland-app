// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { run, repository, transport } = vi.hoisted(() => ({ run: vi.fn(), repository: vi.fn(), transport: vi.fn() }));
vi.mock('@/lib/notifications/dispatch-worker', () => ({ dispatchOne: run }));
vi.mock('@/lib/notifications/dispatch-repository', () => ({ notificationRepository: repository }));
vi.mock('@/lib/notifications/dispatch-transport', () => ({ notificationTransport: transport }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
import { GET, maxDuration } from '@/app/api/notification-drain/route';
const event = '57000000-0000-4000-8000-000000000101';
const request = (auth = 'Bearer synthetic-secret', id = event) => new Request(`https://app.example.test/api/notification-drain?intent=${id}`, { headers: { authorization: auth } });
beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'synthetic-secret'); vi.stubEnv('NOTIFICATION_DISPATCH_ENABLED', 'true');
  vi.stubEnv('LEGACY_ALERT_TRANSPORT_ENABLED', 'false'); vi.stubEnv('NOTIFICATION_DISPATCH_INTENT_IDS', event);
  run.mockResolvedValue('accepted'); repository.mockReturnValue({}); transport.mockReturnValue(vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('controlled notification entry point', () => {
  it('processes only the configured synthetic intent and exposes no IDs or secrets', async () => {
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'accepted' }); expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe(event); expect(maxDuration).toBe(60);
  });
  it.each(['', 'false'])('is disabled by default (%s)', async (value) => {
    vi.stubEnv('NOTIFICATION_DISPATCH_ENABLED', value);
    expect((await GET(request())).status).toBe(503); expect(run).not.toHaveBeenCalled(); expect(repository).not.toHaveBeenCalled();
  });
  it('refuses configured overlap with the legacy sender', async () => {
    vi.stubEnv('LEGACY_ALERT_TRANSPORT_ENABLED', 'true'); expect((await GET(request())).status).toBe(503); expect(run).not.toHaveBeenCalled();
  });
  it('requires a configured secret', async () => {
    vi.stubEnv('CRON_SECRET', ''); expect((await GET(request())).status).toBe(503); expect(run).not.toHaveBeenCalled();
  });
  it.each(['', 'Bearer wrong', 'synthetic-secret'])('denies invalid authorization', async (auth) => {
    expect((await GET(request(auth))).status).toBe(401); expect(run).not.toHaveBeenCalled();
  });
  it.each(['', 'not-uuid', `${event},not-uuid`])('rejects missing/invalid allowlist', async (value) => {
    vi.stubEnv('NOTIFICATION_DISPATCH_INTENT_IDS', value); expect((await GET(request())).status).toBe(503); expect(run).not.toHaveBeenCalled();
  });
  it('does not accept a body/query that expands the allowlist', async () => {
    expect((await GET(request('Bearer synthetic-secret', '57000000-0000-4000-8000-000000000999'))).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'blocked', 'unavailable', 'rejected'])('surfaces %s as requiring attention', async (outcome) => {
    run.mockResolvedValue(outcome); const response = await GET(request()); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ outcome });
  });
  it('sanitizes thrown operational faults', async () => {
    run.mockRejectedValue(new Error('PRIVATE TOKEN')); const response = await GET(request());
    expect(await response.json()).toEqual({ error: 'Notification dispatch is unavailable' });
  });
});
