import { z } from 'zod';
import { decideDispatch } from './dispatch-policy';
import type { NotificationConfig, TransportResult } from '@/supabase/functions/_shared/notification-transport';

const uuid = z.uuid();
const version = z.string().regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => BigInt(value) <= BigInt('9223372036854775807'));
export const dispatchClaimSchema = z.object({ eventId: uuid, token: uuid, version }).strict();
export type DispatchClaim = z.infer<typeof dispatchClaimSchema>;
const preparedSchema = z.object({ id: uuid, channel: z.enum(['push', 'email']) }).strict();
export const startedDispatchSchema = z.discriminatedUnion('channel', [
  z.object({ kind: z.literal('started'), id: uuid, channel: z.literal('push'), email: z.null(),
    subscription: z.object({ endpoint: z.string(), keys: z.object({ p256dh: z.string(), auth: z.string() }).strict() }).strict() }).strict(),
  z.object({ kind: z.literal('started'), id: uuid, channel: z.literal('email'), email: z.string(), subscription: z.null() }).strict(),
]);
export type StartedDispatch = z.infer<typeof startedDispatchSchema>;
export interface DispatchRepository {
  claim(eventId: string): Promise<unknown>;
  snapshot(claim: DispatchClaim): Promise<unknown>;
  prepare(claim: DispatchClaim, configurationReady: boolean): Promise<unknown>;
  start(claim: DispatchClaim, attemptId: string, configurationReady: boolean): Promise<unknown>;
  finish(claim: DispatchClaim, attemptId: string, result: TransportResult): Promise<unknown>;
}
export type DispatchOutcome = 'idle' | 'blocked' | 'not_attempted' | 'accepted' | 'rejected' | 'unknown' | 'unavailable';

function configuration(config: NotificationConfig) {
  let urlReady = false;
  try {
    const url = new URL(config.appUrl ?? 'https://app.heartlandprotocol.org');
    urlReady = url.protocol === 'https:' && !url.username && !url.password;
  } catch { /* Invalid configuration is not an empty destination set. */ }
  return {
    pushConfiguration: !urlReady ? 'invalid_app_url' : !config.vapidPublicKey || !config.vapidPrivateKey ? 'missing_credentials' : 'ready',
    emailConfiguration: !urlReady ? 'invalid_app_url' : !config.resendApiKey ? 'missing_credentials' : 'ready',
  } as const;
}

/** Exactly one bounded invocation; never loops over destinations or retries RPC/HTTP.
 * SQL is the final authorization and lease gate. A lost start response means NO HTTP.
 */
export async function dispatchOne(eventId: string, repository: DispatchRepository, config: NotificationConfig,
  transport: (input: StartedDispatch) => Promise<TransportResult>): Promise<DispatchOutcome> {
  if (!uuid.safeParse(eventId).success) return 'blocked';
  let claim: DispatchClaim;
  let attemptId: string;
  let started: StartedDispatch;
  try {
    const rawClaim = await repository.claim(eventId);
    if (rawClaim === null) return 'idle';
    claim = dispatchClaimSchema.parse(rawClaim);
    if (claim.eventId !== eventId.toLowerCase()) return 'unavailable';
    const snapshot = await repository.snapshot(claim);
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return 'unavailable';
    const identity = z.object({ eventId: uuid, presentedClaim: z.object({ token: uuid, version }).strict(),
      persistedLease: dispatchClaimSchema.passthrough() }).passthrough().safeParse(snapshot);
    if (!identity.success || identity.data.eventId !== claim.eventId
      || identity.data.persistedLease.eventId !== claim.eventId
      || identity.data.presentedClaim.token !== claim.token || identity.data.presentedClaim.version !== claim.version
      || identity.data.persistedLease.token !== claim.token || identity.data.persistedLease.version !== claim.version) return 'unavailable';
    const settings = configuration(config);
    const decision = decideDispatch({ ...snapshot, ...settings });
    if (decision.kind !== 'prepare' && decision.kind !== 'resume_prepared') {
      // Only a genuine configuration block is persisted as such. Corrupt or stale
      // snapshots remain unavailable and cannot authorize any prepare/start call.
      if (decision.kind === 'blocked' && decision.reason === 'configuration') await repository.prepare(claim, false);
      return decision.kind === 'blocked' && ['snapshot_invalid', 'snapshot_unavailable'].includes(decision.reason)
        ? 'unavailable' : 'blocked';
    }
    const rawPrepared = await repository.prepare(claim, settings.pushConfiguration === 'ready');
    if (rawPrepared === null) return 'blocked';
    const prepared = preparedSchema.parse(rawPrepared);
    if (decision.kind === 'resume_prepared' && prepared.id !== decision.attemptId) return 'unavailable';
    if (decision.kind === 'prepare' && prepared.channel !== decision.channel) return 'unavailable';
    attemptId = prepared.id;
    const ready = settings.pushConfiguration === 'ready'
      && (prepared.channel === 'push' || settings.emailConfiguration === 'ready');
    const rawStarted = await repository.start(claim, attemptId, ready);
    if (rawStarted === null) return 'blocked';
    if (z.object({ kind: z.literal('not_attempted') }).strict().safeParse(rawStarted).success) return 'not_attempted';
    started = startedDispatchSchema.parse(rawStarted);
    if (started.id !== attemptId || started.channel !== prepared.channel) return 'unavailable';
  } catch { return 'unavailable'; }

  let result: TransportResult;
  try { result = await transport(started); }
  catch { result = { channel: started.channel, state: 'unknown', code: 'network_error' }; }
  if (result.channel !== started.channel) return 'unknown';
  try {
    const receipt = await repository.finish(claim, attemptId, result);
    // A lost finish response is not proof of rejection and must never trigger fallback.
    return receipt === 'recorded' ? result.state : 'unknown';
  } catch { return 'unknown'; }
}
