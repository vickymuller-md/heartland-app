// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { decideDispatch, type DispatchAttempt, type DispatchSnapshot } from '@/lib/notifications/dispatch-policy';
import { sendEmailAlert, sendWebPush, type TransportDependencies, type TransportResult } from '@/supabase/functions/_shared/notification-transport';

const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const NOW = '2026-09-24T08:00:00Z';
const START = '2026-09-24T07:59:50Z';
const FINISH = '2026-09-24T07:59:55Z';
const EXPIRES = '2026-09-24T08:01:00Z';
const destination = (n: number) => ({ id: id(n), version: '1' });
function snapshot(overrides: Partial<DispatchSnapshot> = {}): DispatchSnapshot {
  const value: DispatchSnapshot = {
    history: 'complete', eventId: id(1), round: 1, observedAt: NOW,
    expectedDestinationCount: 0, expectedAttemptCount: 0,
    destinations: [destination(10), destination(11)], attempts: [],
    presentedClaim: { token: id(2), version: '1' },
    persistedLease: { eventId: id(1), round: 1, token: id(2), version: '1', expiresAt: EXPIRES },
    eligibility: 'eligible', preference: 'allowed', pushConfiguration: 'ready', emailConfiguration: 'ready',
    ...overrides,
  };
  value.expectedDestinationCount = overrides.expectedDestinationCount ?? value.destinations.length;
  value.expectedAttemptCount = overrides.expectedAttemptCount ?? value.attempts.length;
  return value;
}
function attempt(overrides: Partial<DispatchAttempt> = {}): DispatchAttempt {
  return {
    id: id(20), eventId: id(1), round: 1, channel: 'push', destination: destination(10),
    state: 'rejected', code: 'subscription_expired', httpStatus: 410,
    startedAt: START, finishedAt: FINISH, lease: snapshot().persistedLease, ...overrides,
  };
}
function prepared(overrides: Partial<DispatchAttempt> = {}) {
  return attempt({ state: 'prepared', code: null, httpStatus: null, startedAt: null, finishedAt: null, ...overrides });
}
const blocked = (reason: string) => ({ kind: 'blocked', reason });

describe('inert N2 policy, not a worker', () => {
  it('prepares only the first destination and leaves the snapshot byte-identical', () => {
    const input = snapshot(); const before = JSON.stringify(input);
    expect(decideDispatch(input)).toEqual({ kind: 'prepare', channel: 'push', destination: destination(10) });
    expect(JSON.stringify(input)).toBe(before);
  });
  it('continues to the next never-attempted destination across invocations, without retry', () => {
    expect(decideDispatch(snapshot({ attempts: [attempt()] }))).toEqual({ kind: 'prepare', channel: 'push', destination: destination(11) });
    expect(decideDispatch(snapshot({ attempts: [attempt(), attempt({ id: id(21), destination: destination(11) })] })))
      .toEqual({ kind: 'prepare', channel: 'email', destination: null });
  });
  it('permits email for a confirmed zero set only when push configuration is ready', () => {
    expect(decideDispatch(snapshot({ destinations: [] }))).toEqual({ kind: 'prepare', channel: 'email', destination: null });
    expect(decideDispatch(snapshot({ destinations: [], pushConfiguration: 'missing_credentials' }))).toEqual(blocked('configuration'));
  });
  it('walks all 101 identities without truncation or a three-device cap', () => {
    const destinations = Array.from({ length: 101 }, (_, i) => destination(100 + i));
    const attempts = destinations.slice(0, -1).map((target, i) => attempt({ id: id(1000 + i), destination: target }));
    expect(decideDispatch(snapshot({ destinations, attempts }))).toEqual({ kind: 'prepare', channel: 'push', destination: destinations[100] });
  });
  it('allows known invalid subscription without a start or HTTP status', () => {
    expect(decideDispatch(snapshot({ attempts: [attempt({ state: 'not_attempted', code: 'invalid_subscription', httpStatus: null, startedAt: null })] })))
      .toEqual({ kind: 'prepare', channel: 'push', destination: destination(11) });
  });
  it.each(['inactive_org', 'inactive_member', 'no_patient_scope', 'no_active_link', 'no_monitor_authorization',
    'no_consent', 'legacy_owner', 'missing_owner'] as const)('blocks %s for new and prepared attempts', (eligibility) => {
    for (const attempts of [[], [prepared()]]) expect(decideDispatch(snapshot({ eligibility, attempts }))).toEqual(blocked('authorization'));
  });
  it.each(['closed', 'resolved', 'superseded_recipient', 'superseded_generation'] as const)('cancels only unsent %s', (eligibility) => {
    expect(decideDispatch(snapshot({ eligibility, attempts: [prepared()] }))).toEqual({ kind: 'cancel_unsent', reason: eligibility });
    expect(decideDispatch(snapshot({ eligibility, attempts: [attempt({ state: 'unknown', code: 'timeout', httpStatus: null })] })))
      .toEqual({ kind: 'stop', reason: 'unknown_or_started' });
  });
  it('actual recipient mute blocks push, email and resume without suppressing source detection', () => {
    for (const options of [{}, { destinations: [] }, { attempts: [prepared()] }]) {
      expect(decideDispatch(snapshot({ ...options, preference: 'muted' }))).toEqual(blocked('preference'));
    }
  });
  it.each(['missing_credentials', 'invalid_app_url', 'payload_failed'] as const)('blocks current push configuration %s, including resume', (pushConfiguration) => {
    for (const attempts of [[], [prepared()]]) expect(decideDispatch(snapshot({ pushConfiguration, attempts }))).toEqual(blocked('configuration'));
  });
  it.each(['missing_credentials', 'invalid_app_url', 'missing_recipient'] as const)('checks email configuration %s only before email', (emailConfiguration) => {
    expect(decideDispatch(snapshot({ emailConfiguration }))).toMatchObject({ kind: 'prepare', channel: 'push' });
    expect(decideDispatch(snapshot({ emailConfiguration, destinations: [] }))).toEqual(blocked('configuration'));
    expect(decideDispatch(snapshot({ emailConfiguration, destinations: [], attempts: [prepared({ channel: 'email', destination: null })] })))
      .toEqual(blocked('configuration'));
  });
});

describe('durable aggregate order across all rounds', () => {
  const accepted = attempt({ id: id(20), state: 'accepted', code: 'accepted', httpStatus: 202 });
  const unknown = attempt({ id: id(21), destination: destination(11), state: 'unknown', code: 'server_error', httpStatus: 503 });
  const rejected = attempt({ id: id(22), destination: destination(12), code: 'rate_limited', httpStatus: 429 });
  it.each([[accepted, unknown, rejected], [accepted, rejected, unknown], [unknown, accepted, rejected],
    [unknown, rejected, accepted], [rejected, accepted, unknown], [rejected, unknown, accepted]])
    ('acceptance stops every permutation without deleting unknown outcomes: %j', (...attempts) => {
      const input = snapshot({ round: 2, persistedLease: { ...snapshot().persistedLease, round: 2 },
        destinations: [destination(10), destination(11), destination(12)], attempts, preference: 'muted', pushConfiguration: 'missing_credentials' });
      const before = JSON.stringify(input);
      expect(decideDispatch(input)).toEqual({ kind: 'stop', reason: 'accepted' });
      expect(JSON.stringify(input)).toBe(before);
    });
  it.each([false, true])('unknown precedes configuration/rejection irrespective of order=%s', (reverse) => {
    const attempts = [unknown, rejected]; if (reverse) attempts.reverse();
    expect(decideDispatch(snapshot({ attempts, destinations: [destination(10), destination(11), destination(12)], pushConfiguration: 'missing_credentials' })))
      .toEqual({ kind: 'stop', reason: 'unknown_or_started' });
  });
  it.each(['sending', 'unknown'] as const)('never treats expired %s as permission to send', (state) => {
    const entry = state === 'sending' ? attempt({ state, code: null, httpStatus: null, finishedAt: null })
      : attempt({ state, code: 'worker_lost_confirmation', httpStatus: null });
    entry.lease.expiresAt = '2026-09-24T07:59:59Z';
    expect(decideDispatch(snapshot({ attempts: [entry] }))).toEqual({ kind: 'stop', reason: 'unknown_or_started' });
  });
  it.each(['missing_credentials', 'invalid_app_url', 'payload_failed'] as const)('historic %s cannot be bypassed by repaired configuration', (code) => {
    expect(decideDispatch(snapshot({ attempts: [attempt({ state: 'not_attempted', code, httpStatus: null, startedAt: null })] })))
      .toEqual(blocked('configuration'));
  });
  it.each([401, 403, 429, 400, 409, 422])('HTTP %i never retries or falls back', (httpStatus) => {
    const code = [401, 403].includes(httpStatus) ? 'credentials_rejected' : httpStatus === 429 ? 'rate_limited' : 'http_rejected';
    expect(decideDispatch(snapshot({ attempts: [attempt({ code, httpStatus })] })))
      .toEqual(blocked([401, 403].includes(httpStatus) ? 'configuration' : 'rejection'));
  });
  it('an email not attempted for missing recipient is terminal even after configuration is fixed', () => {
    expect(decideDispatch(snapshot({ destinations: [], attempts: [attempt({ channel: 'email', destination: null,
      state: 'not_attempted', code: 'missing_recipient', httpStatus: null, startedAt: null })] })))
      .toEqual({ kind: 'stop', reason: 'email_attempt_exists' });
  });
  it('later rounds cannot restart automatic dispatch after definitive non-delivery either', () => {
    expect(decideDispatch(snapshot({ round: 2, persistedLease: { ...snapshot().persistedLease, round: 2 }, attempts: [attempt()] })))
      .toEqual(blocked('unsupported_round'));
  });
});

describe('claim ownership and prepared attempts', () => {
  it('resumes the same prepared push, never creates a second attempt', () => {
    expect(decideDispatch(snapshot({ attempts: [prepared()] }))).toEqual({ kind: 'resume_prepared', attemptId: id(20) });
  });
  it('resumes the same prepared email only after the entire push set is exhausted', () => {
    const email = prepared({ id: id(22), channel: 'email', destination: null });
    expect(decideDispatch(snapshot({ attempts: [attempt(), attempt({ id: id(21), destination: destination(11) }), email] })))
      .toEqual({ kind: 'resume_prepared', attemptId: id(22) });
    expect(decideDispatch(snapshot({ attempts: [email] }))).toEqual(blocked('snapshot_invalid'));
    expect(decideDispatch(snapshot({ destinations: [], attempts: [email] }))).toEqual({ kind: 'resume_prepared', attemptId: id(22) });
  });
  it.each(['token', 'version'] as const)('requires separately presented %s even when prepared matches persisted lease', (field) => {
    const presentedClaim = { ...snapshot().presentedClaim, [field]: field === 'token' ? id(3) : '2' };
    for (const attempts of [[], [prepared()]]) expect(decideDispatch(snapshot({ attempts, presentedClaim }))).toEqual(blocked('stale_claim'));
  });
  it.each(['token', 'version'] as const)('rejects prepared attempt under old %s despite a currently owned claim', (field) => {
    const entry = prepared({ lease: { ...snapshot().persistedLease, [field]: field === 'token' ? id(3) : '2' } });
    expect(decideDispatch(snapshot({ attempts: [entry] }))).toEqual(blocked('stale_claim'));
  });
  it('requires fenced recovery at exact lease expiry, with or without an unstarted attempt', () => {
    const persistedLease = { ...snapshot().persistedLease, expiresAt: NOW };
    expect(decideDispatch(snapshot({ persistedLease }))).toEqual({ kind: 'recover_unstarted', attemptId: null });
    expect(decideDispatch(snapshot({ persistedLease, attempts: [prepared({ lease: persistedLease })] })))
      .toEqual({ kind: 'recover_unstarted', attemptId: id(20) });
  });
  it('prepared email cannot override unknown push evidence', () => {
    expect(decideDispatch(snapshot({ attempts: [attempt({ state: 'unknown', code: 'timeout', httpStatus: null }),
      prepared({ id: id(22), channel: 'email', destination: null })] }))).toEqual({ kind: 'stop', reason: 'unknown_or_started' });
  });
  it('does not expire a lease 800 microseconds early, including equivalent offsets', () => {
    for (const observedAt of ['2026-09-24T08:00:00.000100Z', '2026-09-24T04:00:00.000100-04:00']) {
      const persistedLease = { ...snapshot().persistedLease, expiresAt: '2026-09-24T08:00:00.000900Z' };
      expect(decideDispatch(snapshot({ observedAt, persistedLease }))).toMatchObject({ kind: 'prepare', channel: 'push' });
      expect(decideDispatch(snapshot({ observedAt, persistedLease, attempts: [prepared({ lease: persistedLease })] })))
        .toEqual({ kind: 'resume_prepared', attemptId: id(20) });
    }
  });
  it('accepts a recorded start strictly before expiry within the same millisecond', () => {
    const entry = attempt({ startedAt: '2026-09-24T08:00:00.000100Z', finishedAt: '2026-09-24T08:00:00.000800Z',
      lease: { ...snapshot().persistedLease, expiresAt: '2026-09-24T04:00:00.000900-04:00' } });
    expect(decideDispatch(snapshot({ observedAt: '2026-09-24T08:00:00.001Z', attempts: [entry] })))
      .toEqual({ kind: 'prepare', channel: 'push', destination: destination(11) });
  });
  it('rejects a finish before start within the same millisecond rather than advancing', () => {
    const entry = attempt({ startedAt: '2026-09-24T08:00:00.000900Z', finishedAt: '2026-09-24T04:00:00.000100-04:00' });
    expect(decideDispatch(snapshot({ observedAt: '2026-09-24T08:00:00.001Z', attempts: [entry] }))).toEqual(blocked('snapshot_invalid'));
  });
  it('rejects precision beyond PostgreSQL microseconds instead of rounding into permission', () => {
    expect(decideDispatch(snapshot({ observedAt: '2026-09-24T08:00:00.0000001Z' }))).toEqual(blocked('snapshot_invalid'));
  });
});

describe('complete, consistent, non-secret snapshots only', () => {
  it.each([null, undefined, {}, { history: 'partial' }, { ...snapshot(), expectedAttemptCount: 1 },
    { ...snapshot(), expectedDestinationCount: 3 }, { ...snapshot(), destinations: [] },
    { ...snapshot(), patientName: 'DO NOT ECHO' }, { ...snapshot(), presentedClaim: undefined }])('rejects malformed/truncated data: %j', (input) => {
      expect(decideDispatch(input)).toEqual(blocked('snapshot_invalid'));
    });
  it('never treats query failure as zero subscriptions', () => {
    expect(decideDispatch({ history: 'unavailable', error: 'PRIVATE SQL ERROR' })).toEqual(blocked('snapshot_unavailable'));
  });
  it.each(['NaN', '01', '0', '-1', '9223372036854775808', '1.2', 'PRIVATE'])('rejects invalid version %s without throwing', (version) => {
    expect(decideDispatch(snapshot({ presentedClaim: { token: id(2), version } }))).toEqual(blocked('snapshot_invalid'));
  });
  it.each([
    { eventId: id(99) }, { destination: destination(99) }, { destination: { ...destination(10), version: '2' } },
    { channel: 'email', destination: destination(10) }, { state: 'accepted', code: 'accepted', httpStatus: 500 },
    { state: 'accepted', code: 'accepted', httpStatus: 201, startedAt: null },
    { state: 'unknown', code: 'timeout', httpStatus: null, startedAt: null },
    { state: 'not_attempted', code: 'invalid_subscription', httpStatus: 410, startedAt: null },
    { code: 'subscription_expired', httpStatus: 429 }, { state: 'prepared', code: null, httpStatus: null, finishedAt: null },
    { state: 'sending', code: null, httpStatus: null, startedAt: null, finishedAt: null },
    { finishedAt: '2026-09-24T08:01:00Z' }, { finishedAt: '2026-09-24T07:00:00Z' },
    { startedAt: EXPIRES }, { lease: { ...snapshot().persistedLease, eventId: id(99) } },
  ])('rejects contradictory or alien attempt: %j', (fields) => {
    expect(decideDispatch(snapshot({ attempts: [attempt(fields as Partial<DispatchAttempt>)] }))).toEqual(blocked('snapshot_invalid'));
  });
  it('rejects duplicate IDs, destination versions and per-round attempt identities', () => {
    expect(decideDispatch(snapshot({ attempts: [attempt(), attempt()] }))).toEqual(blocked('snapshot_invalid'));
    expect(decideDispatch(snapshot({ attempts: [attempt(), attempt({ id: id(21) })] }))).toEqual(blocked('snapshot_invalid'));
    expect(decideDispatch(snapshot({ destinations: [destination(10), { ...destination(10), version: '2' }] }))).toEqual(blocked('snapshot_invalid'));
  });
  it('rejects multiple prepared attempts, skipped cursor and misplaced prepared destination', () => {
    expect(decideDispatch(snapshot({ attempts: [prepared(), prepared({ id: id(21), destination: destination(11) })] }))).toEqual(blocked('snapshot_invalid'));
    expect(decideDispatch(snapshot({ attempts: [attempt({ destination: destination(11) })] }))).toEqual(blocked('snapshot_invalid'));
    expect(decideDispatch(snapshot({ attempts: [prepared({ destination: destination(11) })] }))).toEqual(blocked('snapshot_invalid'));
  });
});

describe('actual N1 adapters, fake network; no legacy aggregate helper', () => {
  const config = { vapidPublicKey: 'synthetic-public', vapidPrivateKey: 'synthetic-private',
    resendApiKey: 'synthetic-email', appUrl: 'https://app.example.test' };
  const subscription = { endpoint: 'https://push.example.test/device', keys: { p256dh: 'synthetic', auth: 'synthetic' } };
  function dependencies(status: number): TransportDependencies {
    return { fetch: vi.fn().mockResolvedValue(new Response(null, { status })),
      buildPushRequest: vi.fn().mockReturnValue({ endpoint: subscription.endpoint, headers: {}, body: new Uint8Array([1]) }) };
  }
  function fromResult(result: TransportResult, destinationIdentity: ReturnType<typeof destination> | null) {
    return attempt({ ...result, destination: destinationIdentity, httpStatus: result.httpStatus ?? null,
      startedAt: result.state === 'not_attempted' ? null : START });
  }
  it.each([201, 301, 303, 307, 400, 401, 403, 404, 408, 410, 422, 429, 500, 503])('uses actual push HTTP %i outcome without reclassification', async (status) => {
    const deps = dependencies(status);
    const result = await sendWebPush(subscription, config, deps);
    const decision = decideDispatch(snapshot({ attempts: [fromResult(result, destination(10))] }));
    const expected = status === 201 ? { kind: 'stop', reason: 'accepted' }
      : [301, 303, 307, 408, 500, 503].includes(status) ? { kind: 'stop', reason: 'unknown_or_started' }
        : [401, 403].includes(status) ? blocked('configuration')
          : [404, 410].includes(status) ? { kind: 'prepare', channel: 'push', destination: destination(11) } : blocked('rejection');
    expect(decision).toEqual(expected); expect(deps.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([202, 404, 410, 429, 503])('an actual email HTTP %i result never enables another attempt', async (status) => {
    const deps = dependencies(status);
    const result = await sendEmailAlert('synthetic@example.test', config, deps);
    const decision = decideDispatch(snapshot({ destinations: [], attempts: [fromResult(result, null)] }));
    expect(['prepare', 'resume_prepared']).not.toContain(decision.kind);
    expect(decision).not.toEqual(blocked('snapshot_invalid')); expect(deps.fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps missing credentials blocked although the N1 adapter says not_attempted', async () => {
    const deps = dependencies(201);
    const result = await sendWebPush(subscription, {}, deps);
    expect(decideDispatch(snapshot({ attempts: [fromResult(result, destination(10))] }))).toEqual(blocked('configuration'));
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it('continues after actual invalid-subscription preflight with no HTTP', async () => {
    const deps = dependencies(201);
    const result = await sendWebPush({ ...subscription, endpoint: 'http://invalid.example.test' }, config, deps);
    expect(decideDispatch(snapshot({ attempts: [fromResult(result, destination(10))] }))).toMatchObject({ kind: 'prepare', channel: 'push' });
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
