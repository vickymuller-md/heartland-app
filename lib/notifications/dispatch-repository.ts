import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DispatchClaim, DispatchRepository } from './dispatch-worker';

/** RPCs are single attempts. Neither errors nor nulls become fabricated snapshots. */
export function notificationRepository(client: SupabaseClient): DispatchRepository {
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Notification persistence unavailable')); }, 5_000);
    });
    try {
      const { data, error } = await Promise.race([client.rpc(name, args).abortSignal(controller.signal), deadline]);
      if (error) throw new Error('Notification persistence unavailable');
      return data;
    } finally { clearTimeout(timer); }
  }
  const identity = (claim: DispatchClaim) => ({ p_intent_id: claim.eventId, p_token: claim.token, p_version: claim.version });
  return {
    claim: (eventId) => rpc('claim_notification_dispatch', { p_intent_id: eventId }),
    snapshot: (claim) => rpc('get_notification_dispatch_snapshot', identity(claim)),
    prepare: (claim, ready) => rpc('prepare_notification_dispatch', { ...identity(claim), p_configuration_ready: ready }),
    start: (claim, id, ready) => rpc('start_notification_dispatch', { ...identity(claim), p_attempt_id: id, p_configuration_ready: ready }),
    finish: (claim, id, result) => rpc('finish_notification_dispatch', { ...identity(claim), p_attempt_id: id,
      p_state: result.state, p_code: result.code, p_http_status: result.httpStatus ?? null }),
  };
}
