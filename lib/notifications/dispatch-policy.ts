import { z } from 'zod';

/** Inert specification of N2 §11.5. No persistence, authorization, HTTP or retry.
 * A repository must supply one complete, consistent service-authorized snapshot.
 * Prepare/resume still require a separately fenced, currently authorized start RPC.
 */
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const version = z.string().regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= BigInt('9223372036854775807'));
const date = z.string().datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value))
  && (value.match(/\.(\d+)/)?.[1].length ?? 0) <= 6);
const round = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const identity = z.object({ id: uuid, version }).strict();
const claim = z.object({ token: uuid, version }).strict();
const lease = claim.extend({ eventId: uuid, round, expiresAt: date }).strict();
const code = z.enum(['accepted', 'credentials_rejected', 'subscription_expired', 'rate_limited',
  'http_rejected', 'redirect_unconfirmed', 'request_timeout', 'server_error', 'timeout',
  'network_error', 'missing_credentials', 'missing_recipient', 'invalid_app_url',
  'invalid_subscription', 'payload_failed', 'worker_lost_confirmation']);
const attemptSchema = z.object({
  id: uuid, eventId: uuid, round, channel: z.enum(['push', 'email']),
  destination: identity.nullable(), lease,
  state: z.enum(['prepared', 'sending', 'accepted', 'rejected', 'unknown', 'not_attempted']),
  code: code.nullable(), httpStatus: z.number().int().min(100).max(599).nullable(),
  startedAt: date.nullable(), finishedAt: date.nullable(),
}).strict();
const snapshotSchema = z.object({
  history: z.literal('complete'), eventId: uuid, round, observedAt: date,
  expectedDestinationCount: z.number().int().nonnegative(),
  expectedAttemptCount: z.number().int().nonnegative(),
  destinations: z.array(identity), attempts: z.array(attemptSchema),
  presentedClaim: claim, persistedLease: lease,
  eligibility: z.enum(['eligible', 'closed', 'resolved', 'superseded_recipient', 'superseded_generation',
    'inactive_org', 'inactive_member', 'no_patient_scope', 'no_active_link',
    'no_monitor_authorization', 'no_consent', 'legacy_owner', 'missing_owner']),
  preference: z.enum(['allowed', 'muted']),
  pushConfiguration: z.enum(['ready', 'missing_credentials', 'invalid_app_url', 'payload_failed']),
  emailConfiguration: z.enum(['ready', 'missing_credentials', 'invalid_app_url', 'missing_recipient']),
}).strict();
export type DispatchSnapshot = z.infer<typeof snapshotSchema>;
export type DispatchAttempt = DispatchSnapshot['attempts'][number];
type Destination = DispatchSnapshot['destinations'][number];
export type DispatchDecision =
  | { kind: 'stop'; reason: 'accepted' | 'unknown_or_started' | 'email_attempt_exists' }
  | { kind: 'blocked'; reason: 'snapshot_unavailable' | 'snapshot_invalid' | 'configuration'
    | 'rejection' | 'preference' | 'authorization' | 'stale_claim' | 'unsupported_round' }
  | { kind: 'cancel_unsent'; reason: 'closed' | 'resolved' | 'superseded_recipient' | 'superseded_generation' }
  | { kind: 'recover_unstarted'; attemptId: string | null }
  | { kind: 'resume_prepared'; attemptId: string }
  | { kind: 'prepare'; channel: 'push'; destination: Destination }
  | { kind: 'prepare'; channel: 'email'; destination: null };

function sameClaim(a: z.infer<typeof claim>, b: z.infer<typeof claim>) {
  return a.token === b.token && a.version === b.version;
}
function key(destination: Destination) { return `${destination.id}:${destination.version}`; }
// Compare PostgreSQL instants without collapsing sub-millisecond ordering or lease expiry.
function micros(value: string): bigint {
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? '';
  return BigInt(Date.parse(value)) * BigInt(1000) + BigInt(fraction.padEnd(6, '0').slice(3, 6));
}
function isConfiguration(attempt: DispatchAttempt) {
  return ['credentials_rejected', 'missing_credentials', 'invalid_app_url', 'payload_failed'].includes(attempt.code ?? '');
}
function isUnusable(attempt: DispatchAttempt) {
  return attempt.channel === 'push' && (
    (attempt.state === 'rejected' && attempt.code === 'subscription_expired' && [404, 410].includes(attempt.httpStatus ?? 0))
    || (attempt.state === 'not_attempted' && attempt.code === 'invalid_subscription'));
}

function validResult(attempt: DispatchAttempt): boolean {
  const { state, code: result, httpStatus: status } = attempt;
  if (state === 'prepared' || state === 'sending') {
    return result === null && status === null && attempt.finishedAt === null
      && (state === 'prepared' ? attempt.startedAt === null : attempt.startedAt !== null);
  }
  if (!attempt.finishedAt || (state !== 'not_attempted' && !attempt.startedAt)) return false;
  if (state === 'not_attempted') return status === null && (
    ['missing_credentials', 'invalid_app_url'].includes(result ?? '')
    || (attempt.channel === 'push' && ['invalid_subscription', 'payload_failed'].includes(result ?? ''))
    || (attempt.channel === 'email' && result === 'missing_recipient'));
  if (state === 'accepted') return result === 'accepted' && status !== null && status >= 200 && status < 300;
  if (state === 'unknown') {
    if (['timeout', 'network_error', 'worker_lost_confirmation'].includes(result ?? '')) return status === null;
    if (result === 'server_error') return status !== null && status >= 500;
    if (result === 'request_timeout') return status === 408;
    return result === 'redirect_unconfirmed' && status !== null && status >= 300 && status < 400;
  }
  if (status === null || status < 400 || status >= 500 || status === 408) return false;
  if ([401, 403].includes(status)) return result === 'credentials_rejected';
  if (status === 429) return result === 'rate_limited';
  if (attempt.channel === 'push' && [404, 410].includes(status)) return result === 'subscription_expired';
  return result === 'http_rejected';
}

function validSnapshot(snapshot: DispatchSnapshot): boolean {
  const { attempts, destinations, persistedLease } = snapshot;
  if (snapshot.expectedAttemptCount !== attempts.length || snapshot.expectedDestinationCount !== destinations.length
    || persistedLease.eventId !== snapshot.eventId || persistedLease.round !== snapshot.round) return false;
  const destinationIds = new Set(destinations.map((destination) => destination.id));
  const destinationKeys = new Set(destinations.map(key));
  if (destinationIds.size !== destinations.length) return false;
  const attemptIds = new Set<string>();
  const attemptIdentities = new Set<string>();
  const observed = micros(snapshot.observedAt);
  let prepared = 0;
  for (const attempt of attempts) {
    if (!validResult(attempt) || attempt.eventId !== snapshot.eventId || attempt.round > snapshot.round
      || attempt.lease.eventId !== snapshot.eventId || attempt.lease.round !== attempt.round
      || attemptIds.has(attempt.id)) return false;
    if ((attempt.channel === 'push') !== (attempt.destination !== null)
      || (attempt.destination && !destinationKeys.has(key(attempt.destination)))) return false;
    const attemptKey = `${attempt.round}:${attempt.channel}:${attempt.destination ? key(attempt.destination) : 'email'}`;
    if (attemptIdentities.has(attemptKey)) return false;
    attemptIds.add(attempt.id); attemptIdentities.add(attemptKey);
    if (attempt.state === 'prepared' && ++prepared > 1) return false;
    if (attempt.startedAt && (micros(attempt.startedAt) > observed
      || micros(attempt.startedAt) >= micros(attempt.lease.expiresAt))) return false;
    if (attempt.finishedAt && (micros(attempt.finishedAt) > observed
      || (attempt.startedAt && micros(attempt.finishedAt) < micros(attempt.startedAt)))) return false;
  }
  return true;
}

export function decideDispatch(input: unknown): DispatchDecision {
  // Explicit read failure, not a synthetic empty list. No error details are echoed.
  if (input && typeof input === 'object' && 'history' in input && input.history === 'unavailable') {
    return { kind: 'blocked', reason: 'snapshot_unavailable' };
  }
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success || !validSnapshot(parsed.data)) return { kind: 'blocked', reason: 'snapshot_invalid' };
  const snapshot = parsed.data;
  const { attempts, persistedLease, presentedClaim } = snapshot;
  // Do not collapse mixed evidence: this only stops new work, never rewrites attempts.
  if (attempts.some((attempt) => attempt.state === 'accepted')) return { kind: 'stop', reason: 'accepted' };
  if (attempts.some((attempt) => attempt.state === 'unknown' || attempt.state === 'sending')) {
    return { kind: 'stop', reason: 'unknown_or_started' };
  }
  if (attempts.some(isConfiguration)) return { kind: 'blocked', reason: 'configuration' };
  if (attempts.some((attempt) => attempt.state === 'rejected' && !isUnusable(attempt))) {
    return { kind: 'blocked', reason: 'rejection' };
  }
  if (attempts.some((attempt) => attempt.channel === 'email' && attempt.state !== 'prepared')) {
    return { kind: 'stop', reason: 'email_attempt_exists' };
  }
  if (snapshot.round !== 1) return { kind: 'blocked', reason: 'unsupported_round' };
  const prepared = attempts.find((attempt) => attempt.state === 'prepared');
  if (!sameClaim(presentedClaim, persistedLease)
    || (prepared && (!sameClaim(prepared.lease, persistedLease) || prepared.round !== snapshot.round))) {
    return { kind: 'blocked', reason: 'stale_claim' };
  }
  if (micros(persistedLease.expiresAt) <= micros(snapshot.observedAt)
    || (prepared && micros(prepared.lease.expiresAt) <= micros(snapshot.observedAt))) {
    return { kind: 'recover_unstarted', attemptId: prepared?.id ?? null };
  }
  switch (snapshot.eligibility) {
    case 'closed': case 'resolved': case 'superseded_recipient': case 'superseded_generation':
      return { kind: 'cancel_unsent', reason: snapshot.eligibility };
    case 'eligible': break;
    default: return { kind: 'blocked', reason: 'authorization' };
  }
  if (snapshot.preference === 'muted') return { kind: 'blocked', reason: 'preference' };
  if (snapshot.pushConfiguration !== 'ready') return { kind: 'blocked', reason: 'configuration' };

  const finishedPush = attempts.filter((attempt) => attempt.channel === 'push' && attempt.state !== 'prepared');
  if (finishedPush.some((attempt) => !isUnusable(attempt))) return { kind: 'blocked', reason: 'snapshot_invalid' };
  const attempted = new Set(finishedPush.map((attempt) => key(attempt.destination!)));
  const nextIndex = snapshot.destinations.findIndex((destination) => !attempted.has(key(destination)));
  const next = snapshot.destinations[nextIndex];
  // Continuation is an ordered prefix, not permission to jump over a missing result.
  if (nextIndex >= 0 && snapshot.destinations.slice(nextIndex + 1).some((destination) => attempted.has(key(destination)))) {
    return { kind: 'blocked', reason: 'snapshot_invalid' };
  }
  if (prepared) {
    if (prepared.channel === 'push' && (!next || !prepared.destination || key(prepared.destination) !== key(next))) {
      return { kind: 'blocked', reason: 'snapshot_invalid' };
    }
    if (prepared.channel === 'email' && next) return { kind: 'blocked', reason: 'snapshot_invalid' };
    if (prepared.channel === 'email' && snapshot.emailConfiguration !== 'ready') return { kind: 'blocked', reason: 'configuration' };
    return { kind: 'resume_prepared', attemptId: prepared.id };
  }
  if (next) return { kind: 'prepare', channel: 'push', destination: next };
  if (snapshot.emailConfiguration !== 'ready') return { kind: 'blocked', reason: 'configuration' };
  return { kind: 'prepare', channel: 'email', destination: null };
}
