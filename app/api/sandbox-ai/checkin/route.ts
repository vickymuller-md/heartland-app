import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runCheckInTurn } from '@/lib/sandbox-ai/engine';
import { runLlmTurn } from '@/lib/sandbox-ai/provider';
import { checkInRequestSchema } from '@/lib/sandbox-ai/schema';

export const dynamic = 'force-dynamic';

// Never 500 with detail: the sandbox chat degrades to the deterministic
// fallback form on any server-side failure (engine, RPC, or vendor).
const FALLBACK_BODY = { fallback: true } as const;

function requestClientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('x-real-ip')?.trim() || forwarded || 'unknown';
}

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = checkInRequestSchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (process.env.SANDBOX_AI_ENABLED !== 'true' || !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(FALLBACK_BODY);
  }
  const rateSecret = process.env.ACCESS_REQUEST_RATE_LIMIT_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rateSecret) return NextResponse.json(FALLBACK_BODY);

  const dailyBucket = new Date().toISOString().slice(0, 10);
  const requesterHash = createHmac('sha256', rateSecret)
    .update(`heartland-sandbox-ai:${dailyBucket}:${requestClientAddress(request)}`)
    .digest('hex');
  const sessionHash = createHmac('sha256', rateSecret)
    .update(parsed.data.anonymousSessionId
      ? `heartland-sandbox-ai-session:v1:${parsed.data.anonymousSessionId}`
      : `heartland-sandbox-ai-session:req:${requesterHash}`)
    .digest('hex');

  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const { data: allowed, error } = await supabaseAdmin.rpc('consume_sandbox_ai_turn', {
      p_requester_hash: requesterHash,
      p_session_hash: sessionHash,
    });
    if (error) {
      console.error('[sandbox-ai] rate-limit RPC unavailable');
      return NextResponse.json(FALLBACK_BODY);
    }
    if (allowed !== true) return NextResponse.json(FALLBACK_BODY, { status: 429 });

    const result = await runCheckInTurn(parsed.data.state, parsed.data.message, {
      callModel: runLlmTurn,
    });
    return NextResponse.json(result);
  } catch {
    console.error('[sandbox-ai] turn failed');
    return NextResponse.json(FALLBACK_BODY);
  }
}
