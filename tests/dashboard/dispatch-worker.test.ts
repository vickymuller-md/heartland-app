// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchOne, type DispatchRepository, type StartedDispatch } from '@/lib/notifications/dispatch-worker';
import { notificationRepository } from '@/lib/notifications/dispatch-repository';
import { notificationTransport, supportedPushEndpoint } from '@/lib/notifications/dispatch-transport';
vi.mock('server-only', () => ({}));

const event = '57000000-0000-4000-8000-000000000101';
const token = '57000000-0000-4000-8000-000000000201';
const attempt = '57000000-0000-4000-8000-000000000301';
const destination = { id: '57000000-0000-4000-8000-000000000401', version: '1' };
const claim = { eventId: event, token, version: '1' };
const lease = { ...claim, round: 1, expiresAt: '2026-09-28T12:02:00Z' };
const config = { vapidPublicKey: 'synthetic', vapidPrivateKey: 'synthetic', resendApiKey: 'synthetic', appUrl: 'https://app.example.test' };
const started: StartedDispatch = { kind: 'started', id: attempt, channel: 'push', email: null,
  subscription: { endpoint: 'https://fcm.googleapis.com/synthetic', keys: { p256dh: 'synthetic', auth: 'synthetic' } } };
function snapshot() {
  return { history: 'complete', eventId: event, round: 1, observedAt: '2026-09-28T12:00:00Z',
    expectedDestinationCount: 1, expectedAttemptCount: 0, destinations: [destination], attempts: [],
    presentedClaim: { token, version: '1' }, persistedLease: lease, eligibility: 'eligible', preference: 'allowed' };
}
function setup() {
  const repo = {
    claim: vi.fn().mockResolvedValue(claim), snapshot: vi.fn().mockResolvedValue(snapshot()),
    prepare: vi.fn().mockResolvedValue({ id: attempt, channel: 'push' }), start: vi.fn().mockResolvedValue(started),
    finish: vi.fn().mockResolvedValue('recorded'),
  } satisfies DispatchRepository;
  const transport = vi.fn().mockResolvedValue({ channel: 'push', state: 'accepted', code: 'accepted', httpStatus: 201 });
  return { repo, transport, run: () => dispatchOne(event, repo, config, transport) };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('persisted notification orchestration', () => {
  it('orders prepare/start before exactly one transport and finish', async () => {
    const { repo, transport, run } = setup();
    expect(await run()).toBe('accepted');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(repo.prepare.mock.invocationCallOrder[0]).toBeLessThan(repo.start.mock.invocationCallOrder[0]);
    expect(repo.start.mock.invocationCallOrder[0]).toBeLessThan(transport.mock.invocationCallOrder[0]);
    expect(transport.mock.invocationCallOrder[0]).toBeLessThan(repo.finish.mock.invocationCallOrder[0]);
    expect(repo.finish).toHaveBeenCalledWith(claim, attempt, { channel: 'push', state: 'accepted', code: 'accepted', httpStatus: 201 });
  });
  it.each(['claim', 'snapshot', 'prepare', 'start'] as const)('never sends when %s throws', async (method) => {
    const { repo, transport, run } = setup();
    repo[method].mockRejectedValue(new Error('PRIVATE'));
    expect(await run()).toBe('unavailable');
    expect(transport).not.toHaveBeenCalled();
    expect(repo[method]).toHaveBeenCalledTimes(1);
  });
  it.each(['claim', 'prepare', 'start'] as const)('never sends when %s is null', async (method) => {
    const { repo, transport, run } = setup(); repo[method].mockResolvedValue(null);
    expect(await run()).toBe(method === 'claim' ? 'idle' : 'blocked');
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { ...snapshot(), expectedDestinationCount: 2 }, { ...snapshot(), history: 'unavailable' }])
    ('fails closed for incomplete snapshot %j', async (value) => {
      const { repo, transport, run } = setup(); repo.snapshot.mockResolvedValue(value);
      expect(await run()).toBe('unavailable'); expect(transport).not.toHaveBeenCalled();
      expect(repo.prepare).not.toHaveBeenCalled();
    });
  it.each(['accepted', 'unknown', 'sending'])('does not replay durable %s evidence', async (state) => {
    const { repo, transport, run } = setup();
    repo.snapshot.mockResolvedValue({ ...snapshot(), expectedAttemptCount: 1, attempts: [{ id: attempt,
      eventId: event, round: 1, channel: 'push', destination, lease, state,
      code: state === 'accepted' ? 'accepted' : state === 'unknown' ? 'network_error' : null,
      httpStatus: state === 'accepted' ? 201 : null, startedAt: '2026-09-28T11:59:55Z',
      finishedAt: state === 'sending' ? null : '2026-09-28T11:59:56Z' }] });
    expect(await run()).toBe('blocked'); expect(transport).not.toHaveBeenCalled();
    expect(repo.prepare).not.toHaveBeenCalled();
  });
  it.each(['event', 'token', 'version'])('rejects an internally consistent snapshot for another %s', async (field) => {
    const { repo, transport, run } = setup();
    const other = field === 'version' ? '2' : '57000000-0000-4000-8000-000000000999';
    const data = snapshot();
    if (field === 'event') { data.eventId = other; data.persistedLease = { ...lease, eventId: other }; }
    else {
      data.presentedClaim = { ...data.presentedClaim, [field]: other };
      data.persistedLease = { ...lease, [field]: other };
    }
    repo.snapshot.mockResolvedValue(data);
    expect(await run()).toBe('unavailable'); expect(transport).not.toHaveBeenCalled();
    expect(repo.prepare).not.toHaveBeenCalled();
  });
  it('blocks missing configuration even with a known empty push set', async () => {
    const { repo, transport } = setup(); repo.snapshot.mockResolvedValue({ ...snapshot(), expectedDestinationCount: 0, destinations: [] });
    expect(await dispatchOne(event, repo, { ...config, vapidPrivateKey: undefined }, transport)).toBe('blocked');
    expect(repo.prepare).toHaveBeenCalledWith(claim, false); expect(transport).not.toHaveBeenCalled();
  });
  it('does not turn an invalidated preflight subscription into a network call', async () => {
    const { repo, transport, run } = setup(); repo.start.mockResolvedValue({ kind: 'not_attempted' });
    expect(await run()).toBe('not_attempted'); expect(transport).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...started, id: event }, { ...started, privatePayload: 'no' }])('does not send from malformed start proof', async (value) => {
    const { repo, transport, run } = setup(); repo.start.mockResolvedValue(value);
    expect(await run()).toBe(value === null ? 'blocked' : 'unavailable'); expect(transport).not.toHaveBeenCalled();
  });
  it('records a thrown transport as unknown, without retry/fallback', async () => {
    const { repo, transport, run } = setup(); transport.mockRejectedValue(new Error('PRIVATE'));
    expect(await run()).toBe('unknown'); expect(transport).toHaveBeenCalledTimes(1);
    expect(repo.finish).toHaveBeenCalledWith(claim, attempt, { channel: 'push', state: 'unknown', code: 'network_error' });
  });
  it.each(['stale', 'late_evidence', null])('does not infer acceptance from ambiguous finish %s', async (receipt) => {
    const { repo, transport, run } = setup(); repo.finish.mockResolvedValue(receipt);
    expect(await run()).toBe('unknown'); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not resend after database write failure following HTTP', async () => {
    const { repo, transport, run } = setup(); repo.finish.mockRejectedValue(new Error('PRIVATE'));
    expect(await run()).toBe('unknown'); expect(transport).toHaveBeenCalledTimes(1); expect(repo.finish).toHaveBeenCalledTimes(1);
  });
  it.each([[410, 'subscription_expired'], [429, 'rate_limited'], [403, 'credentials_rejected']])
    ('persists rejection %i and returns without same-invocation continuation', async (httpStatus, code) => {
      const { transport, run } = setup(); transport.mockResolvedValue({ channel: 'push', state: 'rejected', code, httpStatus });
      expect(await run()).toBe('rejected'); expect(transport).toHaveBeenCalledTimes(1);
    });
});

describe('repository safety and bounded runtime', () => {
  it('bounds a hanging RPC even when an adapter ignores abort', async () => {
    vi.useFakeTimers();
    const builder = { abortSignal: vi.fn().mockReturnValue(new Promise(() => {})) };
    const rpc = vi.fn().mockReturnValue(builder);
    const repo = notificationRepository({ rpc } as unknown as SupabaseClient);
    const pending = repo.claim(event).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBe('Notification persistence unavailable');
    expect(builder.abortSignal.mock.calls[0][0].aborted).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('sanitizes database errors without manufacturing a snapshot', async () => {
    const rpc = vi.fn().mockReturnValue({ abortSignal: () => Promise.resolve({ data: null, error: { message: 'SECRET' } }) });
    await expect(notificationRepository({ rpc } as unknown as SupabaseClient).snapshot(claim)).rejects.toThrow('Notification persistence unavailable');
  });
  it.each(['https://127.0.0.1/device', 'https://private.example/device', 'https://fcm.googleapis.com.evil.test/a',
    'http://fcm.googleapis.com/a', 'https://user:pass@fcm.googleapis.com/a', 'https://fcm.googleapis.com:444/a'])
    ('rejects unreviewed push endpoint %s', (endpoint) => expect(supportedPushEndpoint(endpoint)).toBe(false));
  it.each(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'])
    ('supports known provider %s', (host) => expect(supportedPushEndpoint(`https://${host}/synthetic`)).toBe(true));
  it('blocks an arbitrary endpoint before network/signing', async () => {
    const fetcher = vi.fn();
    expect(await notificationTransport(config, fetcher)({ ...started, subscription: { ...started.subscription!, endpoint: 'https://localhost/private' } } as StartedDispatch))
      .toEqual({ channel: 'push', state: 'not_attempted', code: 'invalid_subscription' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the real generic email adapter with one simulated HTTP', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    expect(await notificationTransport(config, fetcher)({ kind: 'started', id: attempt, channel: 'email', subscription: null, email: 'synthetic@example.invalid' }))
      .toEqual({ channel: 'email', state: 'accepted', code: 'accepted', httpStatus: 202 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].body).not.toMatch(/patient|critical|severity|57000000/i);
  });
});
