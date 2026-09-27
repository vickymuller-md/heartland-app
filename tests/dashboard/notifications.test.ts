// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEmailAlert, sendWebPush, type TransportDependencies } from '@/supabase/functions/_shared/notification-transport';

const subscription = {
  endpoint: 'https://push.example.test/private-device-token',
  keys: { p256dh: 'synthetic-public', auth: 'synthetic-auth' },
};
const config = {
  vapidPublicKey: 'synthetic-public', vapidPrivateKey: 'synthetic-private',
  resendApiKey: 'synthetic-email-key', appUrl: 'https://app.example.test',
};
function dependencies(status = 201) {
  return {
    fetch: vi.fn().mockResolvedValue(new Response(null, { status })),
    buildPushRequest: vi.fn().mockReturnValue({ endpoint: subscription.endpoint,
      headers: { Authorization: 'synthetic-vapid' }, body: new Uint8Array([1, 2, 3]) }),
  } satisfies TransportDependencies;
}
afterEach(() => vi.useRealTimers());

describe('real notification transport with a simulated network', () => {
  it.each([200, 201, 202, 204])('reports HTTP %i as accepted, never delivered/read', async status => {
    const deps = dependencies(status);
    expect(await sendWebPush(subscription, config, deps)).toEqual({
      channel: 'push', state: 'accepted', code: 'accepted', httpStatus: status,
    });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(deps.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(deps.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    [401, 'rejected', 'credentials_rejected'], [403, 'rejected', 'credentials_rejected'],
    [404, 'rejected', 'subscription_expired'], [410, 'rejected', 'subscription_expired'],
    [429, 'rejected', 'rate_limited'], [400, 'rejected', 'http_rejected'],
    [302, 'unknown', 'redirect_unconfirmed'], [408, 'unknown', 'request_timeout'],
    [500, 'unknown', 'server_error'], [503, 'unknown', 'server_error'],
  ])('classifies HTTP %i without exposing the response body', async (status, state, code) => {
    const deps = dependencies(Number(status));
    expect(await sendWebPush(subscription, config, deps)).toEqual({ channel: 'push', state, code, httpStatus: status });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });
  it('builds only generic push content without patient/alert identifiers', async () => {
    const deps = dependencies();
    await sendWebPush(subscription, config, deps);
    expect(JSON.parse(deps.buildPushRequest.mock.calls[0][1])).toEqual({
      title: 'HEARTLAND', body: 'A new update is available. Sign in to review it.', data: { url: '/alerts' },
    });
  });
  it('builds generic email pointing to the authenticated route without query/fragment', async () => {
    const deps = dependencies(202);
    expect(await sendEmailAlert('provider@example.test', { ...config,
      appUrl: 'https://app.example.test/path?private=value#fragment' }, deps))
      .toMatchObject({ channel: 'email', state: 'accepted', httpStatus: 202 });
    const body = JSON.parse(deps.fetch.mock.calls[0][1].body);
    expect(body.subject).toBe('HEARTLAND update');
    expect(body.to).toEqual(['provider@example.test']);
    expect(body.html).toContain('href="https://app.example.test/alerts"');
    expect(body.html).not.toMatch(/private|fragment|Patient:|CRITICAL|SBP|alertId/);
  });
  it.each(['http://app.example.test', 'javascript:alert(1)', 'https://user:pass@app.example.test', 'bad-url'])
    ('rejects unsafe APP_URL %s before sending', async appUrl => {
      const deps = dependencies();
      expect(await sendEmailAlert('provider@example.test', { ...config, appUrl }, deps))
        .toMatchObject({ state: 'not_attempted', code: 'invalid_app_url' });
      expect(deps.fetch).not.toHaveBeenCalled();
    });
  it.each(['http://push.example.test/device', 'https://user:pass@push.example.test/device', 'not-url'])
    ('rejects invalid subscription %s before sending', async endpoint => {
      const deps = dependencies();
      expect(await sendWebPush({ ...subscription, endpoint }, config, deps))
        .toEqual({ channel: 'push', state: 'not_attempted', code: 'invalid_subscription' });
      expect(deps.fetch).not.toHaveBeenCalled();
    });
  it('does not attempt push without both VAPID keys', async () => {
    const deps = dependencies();
    expect(await sendWebPush(subscription, { ...config, vapidPrivateKey: undefined }, deps))
      .toMatchObject({ state: 'not_attempted', code: 'missing_credentials' });
    expect(deps.buildPushRequest).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it('sanitizes builder errors before any network attempt', async () => {
    const deps = dependencies();
    deps.buildPushRequest.mockImplementation(() => { throw new Error('PRIVATE ENDPOINT SECRET'); });
    expect(await sendWebPush(subscription, config, deps))
      .toEqual({ channel: 'push', state: 'not_attempted', code: 'payload_failed' });
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it('does not send email without credentials or recipient', async () => {
    const deps = dependencies();
    expect(await sendEmailAlert('provider@example.test', { ...config, resendApiKey: undefined }, deps))
      .toMatchObject({ state: 'not_attempted', code: 'missing_credentials' });
    expect(await sendEmailAlert(null, config, deps)).toMatchObject({ state: 'not_attempted', code: 'missing_recipient' });
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'rejected', 'credentials_rejected'], [410, 'rejected', 'http_rejected'],
    [429, 'rejected', 'rate_limited'], [500, 'unknown', 'server_error'],
  ])('classifies email HTTP %i without reporting successful delivery', async (status, state, code) => {
    const deps = dependencies(Number(status));
    deps.fetch.mockResolvedValue(new Response('PRIVATE PROVIDER ERROR', { status: Number(status) }));
    expect(await sendEmailAlert('provider@example.test', config, deps))
      .toEqual({ channel: 'email', state, code, httpStatus: status });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a subscription missing encryption keys before calling the builder', async () => {
    const deps = dependencies();
    expect(await sendWebPush({ ...subscription, keys: { p256dh: '', auth: '' } }, config, deps))
      .toMatchObject({ state: 'not_attempted', code: 'invalid_subscription' });
    expect(deps.buildPushRequest).not.toHaveBeenCalled();
  });
  it('reports a lost response as unknown, without leaking exceptions or retrying', async () => {
    const deps = dependencies();
    deps.fetch.mockRejectedValue(new Error('PRIVATE ENDPOINT SECRET'));
    expect(await sendWebPush(subscription, config, deps))
      .toEqual({ channel: 'push', state: 'unknown', code: 'network_error' });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['push', 'email'])('bounds a hanging %s request even if fetch ignores abort', async channel => {
    vi.useFakeTimers();
    const deps = dependencies();
    deps.fetch.mockImplementation(() => new Promise(() => {}));
    const pending = channel === 'push' ? sendWebPush(subscription, config, deps)
      : sendEmailAlert('provider@example.test', config, deps);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ channel, state: 'unknown', code: 'timeout' });
    expect(deps.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('clears the deadline after a completed request', async () => {
    vi.useFakeTimers();
    await sendWebPush(subscription, config, dependencies());
    expect(vi.getTimerCount()).toBe(0);
  });
});
