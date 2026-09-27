// @vitest-environment node
/** Executes the actual Edge handler; only runtime, database, signing and network are mocked. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as transport from '@/supabase/functions/_shared/notification-transport';

const compiled = ts.transpileModule(readFileSync(resolve('supabase/functions/alert-eval/index.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(options: {
  statuses?: number[]; subscriptions?: number; created?: boolean; sbp?: number;
  linksError?: boolean; subscriptionsError?: boolean; emailError?: boolean;
  noProviders?: boolean; noEmail?: boolean; noKeys?: boolean; hang?: boolean; dyspnea?: number;
  legacyEvaluation?: string | null; legacyTransport?: string | null;
} = {}) {
  const sub = { endpoint: 'https://push.example.test/PRIVATE_DEVICE', keys: { auth: 'test', p256dh: 'test' } };
  const queries: Array<{ table: string; fields: string; filters: unknown[] }> = [];
  const from = vi.fn((table: string) => {
    const query = { table, fields: '', filters: [] as unknown[] };
    queries.push(query);
    const response = () => {
      if (table === 'symptoms') return { data: [{ red_flag: false, dyspnea: options.dyspnea ?? 0 }], error: null };
      if (table === 'provider_patient_links') return { data: options.noProviders ? [] : [{ provider_id: 'synthetic-provider' }],
        error: options.linksError ? { message: 'PRIVATE QUERY ERROR' } : null };
      if (table === 'push_subscriptions') return { data: Array.from({ length: options.subscriptions ?? 1 }, () => sub),
        error: options.subscriptionsError ? { message: 'PRIVATE QUERY ERROR' } : null };
      return { data: { email: options.noEmail ? null : 'provider@example.test', full_name: 'PRIVATE PATIENT NAME' },
        error: options.emailError ? { message: 'PRIVATE QUERY ERROR' } : null };
    };
    const chain = {
      select: (fields: string) => { query.fields = fields; return chain; },
      eq: (...filter: unknown[]) => { query.filters.push(filter); return chain; },
      order: () => chain, limit: async () => response(), single: async () => response(),
      then: (accept: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(response()).then(accept, reject),
    };
    return chain;
  });
  const rpc = vi.fn().mockResolvedValue({ data: [{ alert_id: 'PRIVATE_ALERT_ID', created: options.created ?? true }], error: null });
  const createClient = vi.fn(() => ({ from, rpc }));
  let requestIndex = 0;
  const fetch = vi.fn().mockImplementation(() => options.hang ? new Promise(() => {})
    : Promise.resolve(new Response(null, { status: options.statuses?.[requestIndex++] ?? 201 })));
  const buildRequest = vi.fn().mockReturnValue({ endpoint: sub.endpoint, headers: {}, body: new Uint8Array([1]) });
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const env: Record<string, string | undefined> = {
    SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
    VAPID_PUBLIC_KEY: options.noKeys ? undefined : 'test-public', VAPID_PRIVATE_KEY: options.noKeys ? undefined : 'test-private',
    RESEND_API_KEY: 'test-email-key', APP_URL: 'https://app.example.test',
    // Compatibility tests opt in; real handler defaults remain OFF.
    LEGACY_ALERT_EVAL_ENABLED: options.legacyEvaluation === null ? undefined : options.legacyEvaluation ?? 'true',
    LEGACY_ALERT_TRANSPORT_ENABLED: options.legacyTransport === null ? undefined : options.legacyTransport ?? 'true',
  };
  let handler!: (request: Request) => Promise<Response>;
  const require = (specifier: string) => {
    if (specifier.startsWith('npm:@supabase/')) return { createClient };
    if (specifier === 'npm:web-push@3.6.7') return { default: { generateRequestDetails: buildRequest } };
    if (specifier === '../_shared/notification-transport.ts') return transport;
    throw new Error(`Unmocked dependency: ${specifier}`);
  };
  new Function('require', 'exports', 'Deno', 'fetch', 'console', compiled)(require, {}, {
    serve: (callback: typeof handler) => { handler = callback; }, env: { get: (key: string) => env[key] },
  }, fetch, log);
  const run = () => handler(new Request('https://edge.example.test', { method: 'POST', body: JSON.stringify({
    type: 'INSERT', table: 'vitals', schema: 'public', record: {
      id: 'synthetic-vitals', patient_id: 'PRIVATE_PATIENT_ID', recorded_at: '2026-09-21T00:00:00Z',
      weight_lbs: null, sbp: options.sbp ?? 80, dbp: 70, heart_rate: 80, spo2: 98,
    },
  }) }));
  return { run, invoke: handler, createClient, from, fetch, buildRequest, queries, rpc, log };
}
afterEach(() => vi.useRealTimers());

describe('notification routing through the actual Edge handler', () => {
  it.each([null, 'false', '', 'TRUE', '1', ' true '])('does no work with legacy evaluation disabled: %j', async (legacyEvaluation) => {
    const app = harness({ legacyEvaluation, legacyTransport: 'true' });
    const response = await app.invoke(new Request('https://edge.example.test', { method: 'POST', body: 'invalid JSON not to be parsed' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Legacy alert evaluation is disabled', code: 'legacy_evaluation_disabled' });
    expect(app.createClient).not.toHaveBeenCalled(); expect(app.from).not.toHaveBeenCalled();
    expect(app.rpc).not.toHaveBeenCalled(); expect(app.fetch).not.toHaveBeenCalled();
    expect(app.buildRequest).not.toHaveBeenCalled(); expect(app.log.error).not.toHaveBeenCalled();
  });
  it.each([null, 'false', '', 'TRUE', '1', ' true '])('evaluation-only mode has no recipient lookup or HTTP: %j', async (legacyTransport) => {
    const app = harness({ legacyEvaluation: 'true', legacyTransport });
    const response = await app.run();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ alert: true, created: true,
      notifications: { accepted: 0, rejected: 0, unknown: 0, not_attempted: 1 } });
    expect(app.rpc).toHaveBeenCalledTimes(1);
    expect(app.queries.map((query) => query.table)).not.toEqual(expect.arrayContaining(['provider_patient_links']));
    expect(app.queries.some((query) => ['provider_patient_links', 'profiles', 'push_subscriptions'].includes(query.table))).toBe(false);
    expect(app.fetch).not.toHaveBeenCalled(); expect(app.buildRequest).not.toHaveBeenCalled();
    expect(app.log.warn).toHaveBeenCalledWith('notification_delivery', { channel: 'routing', state: 'not_attempted', code: 'legacy_transport_disabled' });
  });
  it('both switches absent remains disabled regardless of critical payload', async () => {
    const app = harness({ legacyEvaluation: null, legacyTransport: null });
    expect((await app.run()).status).toBe(503);
    expect(app.createClient).not.toHaveBeenCalled(); expect(app.fetch).not.toHaveBeenCalled();
  });
  it('falls back once after expired push', async () => {
    const app = harness({ statuses: [410, 202] });
    expect((await app.run()).status).toBe(200);
    expect(app.fetch).toHaveBeenCalledTimes(2);
    expect(app.fetch.mock.calls[1][0]).toBe('https://api.resend.com/emails');
  });
  it('uses email when push credentials are missing', async () => {
    const app = harness({ noKeys: true });
    await app.run();
    expect(app.fetch).toHaveBeenCalledTimes(1);
    expect(app.fetch.mock.calls[0][0]).toBe('https://api.resend.com/emails');
  });
  it('does not fetch names or expose clinical identifiers in notifications/logs', async () => {
    const app = harness();
    await app.run();
    expect(app.queries.some(query => query.fields.includes('full_name'))).toBe(false);
    expect(JSON.stringify(app.buildRequest.mock.calls)).not.toMatch(/PRIVATE_PATIENT|PRIVATE_ALERT|SBP|CRITICAL:/);
    expect(JSON.stringify([...app.log.error.mock.calls, ...app.log.warn.mock.calls, ...app.log.info.mock.calls])).not.toContain('PRIVATE');
  });
  it('does not treat subscription lookup failure as no subscriptions', async () => {
    const app = harness({ subscriptionsError: true });
    await app.run();
    expect(app.fetch).not.toHaveBeenCalled();
    expect(app.log.warn).toHaveBeenCalledWith('notification_delivery', expect.objectContaining({ code: 'subscription_lookup_failed' }));
  });
  it('does not send after a provider lookup error', async () => {
    const app = harness({ linksError: true });
    await app.run();
    expect(app.fetch).not.toHaveBeenCalled();
  });
  it('preserves partial acceptance without duplicating via email', async () => {
    const app = harness({ subscriptions: 2, statuses: [201, 410] });
    const body = await (await app.run()).json();
    expect(body.notifications).toEqual({ accepted: 1, rejected: 1, unknown: 0, not_attempted: 0 });
    expect(app.fetch).toHaveBeenCalledTimes(2);
    expect(app.fetch.mock.calls.every(call => call[0].startsWith('https://push.'))).toBe(true);
    expect(app.log.warn).toHaveBeenCalledWith('notification_delivery', expect.objectContaining({ code: 'subscription_expired' }));
  });
  it('does not fallback when another device has an uncertain result', async () => {
    const app = harness({ subscriptions: 2, statuses: [410, 500] });
    const body = await (await app.run()).json();
    expect(body.notifications).toEqual({ accepted: 0, rejected: 1, unknown: 1, not_attempted: 0 });
    expect(app.fetch).toHaveBeenCalledTimes(2);
    expect(app.fetch.mock.calls.every(call => call[0].startsWith('https://push.'))).toBe(true);
  });
  it('records both rejected channels without claiming notification success', async () => {
    const app = harness({ statuses: [401, 429] });
    const body = await (await app.run()).json();
    expect(body.alert).toBe(true);
    expect(body.notifications).toEqual({ accepted: 0, rejected: 2, unknown: 0, not_attempted: 0 });
    expect(app.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(app.log.warn.mock.calls)).not.toMatch(/PRIVATE|provider@example/);
  });
  it('does not fallback/retry after ambiguous server failure', async () => {
    const app = harness({ statuses: [500] });
    await app.run();
    expect(app.fetch).toHaveBeenCalledTimes(1);
    expect(app.log.warn).toHaveBeenCalledWith('notification_delivery', expect.objectContaining({ state: 'unknown', code: 'server_error' }));
  });
  it.each([301, 302, 303, 307, 308])('does not follow HTTP %i or resend by email', async status => {
    const app = harness({ statuses: [status] });
    const body = await (await app.run()).json();
    expect(body.notifications).toEqual({ accepted: 0, rejected: 0, unknown: 1, not_attempted: 0 });
    expect(app.fetch).toHaveBeenCalledTimes(1);
    expect(app.fetch.mock.calls[0][1].redirect).toBe('manual');
    expect(app.log.warn).toHaveBeenCalledWith('notification_delivery', expect.objectContaining({ code: 'redirect_unconfirmed' }));
  });
  it('returns a persisted signal with unknown transport after timeout, without fallback', async () => {
    vi.useFakeTimers();
    const app = harness({ hang: true });
    const pending = app.run();
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe(200);
    expect(app.fetch).toHaveBeenCalledTimes(1);
    expect(app.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(app.log.warn).toHaveBeenCalledWith('notification_delivery', expect.objectContaining({ state: 'unknown', code: 'timeout' }));
  });
  it.each([{ noProviders: true }, { subscriptions: 0, noEmail: true }, { subscriptions: 0, emailError: true }])
    ('reports unavailable routing without sending: %j', async options => {
      const app = harness(options);
      await app.run();
      expect(app.fetch).not.toHaveBeenCalled();
      expect(app.log.warn).toHaveBeenCalled();
    });
  it('uses generic email when no push subscription exists', async () => {
    const app = harness({ subscriptions: 0 });
    await app.run();
    expect(app.fetch).toHaveBeenCalledTimes(1);
    expect(app.fetch.mock.calls[0][1].body).not.toMatch(/PRIVATE|Patient:|SBP|CRITICAL/);
  });
  it('does not broaden the created-alert policy', async () => {
    const app = harness({ created: false });
    await app.run();
    expect(app.rpc).toHaveBeenCalled();
    expect(app.fetch).not.toHaveBeenCalled();
  });
  it('preserves warning-only behavior without sending notifications', async () => {
    const app = harness({ sbp: 120, dyspnea: 3 });
    const body = await (await app.run()).json();
    expect(body).toMatchObject({ alert: true, severity: 'warning', created: true });
    expect(app.fetch).not.toHaveBeenCalled();
  });
  it('does not send when thresholds are not met', async () => {
    const app = harness({ sbp: 120 });
    expect(await (await app.run()).json()).toEqual({ alert: false });
    expect(app.rpc).not.toHaveBeenCalled();
    expect(app.fetch).not.toHaveBeenCalled();
  });
});
