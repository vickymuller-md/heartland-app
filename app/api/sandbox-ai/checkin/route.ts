import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { clipIdForText } from '@/lib/sandbox-ai/call-prompts';
import { runCheckInTurn } from '@/lib/sandbox-ai/engine';
import { runLlmTurn } from '@/lib/sandbox-ai/provider';
import { checkInRequestSchema } from '@/lib/sandbox-ai/schema';
import { synthesizeSpeech } from '@/lib/sandbox-ai/tts';
import type { SpeechItem } from '@/lib/sandbox-ai/types';

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

    // Simulated live call: attach per-message audio. Canonical lines resolve
    // to static clip refs (no cost); only dynamic lines (small-talk acks,
    // paraphrases) are synthesized. Completed turns keep the fixed
    // disposition clips the client already plays, so no synthesis there.
    if (parsed.data.wantSpeech && !result.done && !result.fallback) {
      const speech: Array<SpeechItem | null> = await Promise.all(
        result.assistantMessages.map(async (message) => {
          const clipId = clipIdForText(message);
          if (clipId) return { kind: 'clip' as const, clipId };
          const mp3Base64 = await synthesizeSpeech(message);
          return mp3Base64 ? { kind: 'audio' as const, mp3Base64 } : null;
        }),
      );
      return NextResponse.json({ ...result, speech });
    }
    return NextResponse.json(result);
  } catch {
    console.error('[sandbox-ai] turn failed');
    return NextResponse.json(FALLBACK_BODY);
  }
}
