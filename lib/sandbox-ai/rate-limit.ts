/**
 * Sandbox AI -- Shared Public-Endpoint Authorization
 *
 * The check-in and assist endpoints share one budget: the same HMAC hashing
 * scheme and the same consume_sandbox_ai_turn RPC (per-session, per-requester,
 * and global daily caps live in migration 00033). The hash input prefixes are
 * load-bearing — changing them would reset every counter bucket.
 */

import 'server-only';
import { createHmac } from 'node:crypto';

export type SandboxAiAuthorization = 'allowed' | 'limited' | 'unavailable';
export type SandboxAiTurnKind = 'turn' | 'copilot';

function requestClientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('x-real-ip')?.trim() || forwarded || 'unknown';
}

export function sandboxAiEnabled(): boolean {
  return process.env.SANDBOX_AI_ENABLED === 'true' && Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Consume one turn from the kind-scoped sandbox-AI budget for this request. */
export async function consumeSandboxAiTurn(
  request: Request,
  anonymousSessionId: string | undefined,
  kind: SandboxAiTurnKind = 'turn',
): Promise<SandboxAiAuthorization> {
  const rateSecret = process.env.ACCESS_REQUEST_RATE_LIMIT_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rateSecret) return 'unavailable';

  const dailyBucket = new Date().toISOString().slice(0, 10);
  const requesterHash = createHmac('sha256', rateSecret)
    .update(`heartland-sandbox-ai:${dailyBucket}:${requestClientAddress(request)}`)
    .digest('hex');
  const sessionHash = createHmac('sha256', rateSecret)
    .update(anonymousSessionId
      ? `heartland-sandbox-ai-session:v1:${anonymousSessionId}`
      : `heartland-sandbox-ai-session:req:${requesterHash}`)
    .digest('hex');

  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const { data: allowed, error } = await supabaseAdmin.rpc('consume_sandbox_ai_turn_v2', {
    p_requester_hash: requesterHash,
    p_session_hash: sessionHash,
    p_kind: kind,
  });
  if (error) {
    console.error('[sandbox-ai] rate-limit RPC unavailable');
    return 'unavailable';
  }
  return allowed === true ? 'allowed' : 'limited';
}
