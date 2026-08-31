import { NextResponse } from 'next/server';
import { clipIdForText } from '@/lib/sandbox-ai/call-prompts';
import { runCheckInTurn } from '@/lib/sandbox-ai/engine';
import { runLlmTurn } from '@/lib/sandbox-ai/provider';
import { consumeSandboxAiTurn, sandboxAiEnabled } from '@/lib/sandbox-ai/rate-limit';
import { checkInRequestSchema } from '@/lib/sandbox-ai/schema';
import { synthesizeSpeech } from '@/lib/sandbox-ai/tts';
import type { SpeechItem } from '@/lib/sandbox-ai/types';

export const dynamic = 'force-dynamic';

// Never 500 with detail: the sandbox chat degrades to the deterministic
// fallback form on any server-side failure (engine, RPC, or vendor).
const FALLBACK_BODY = { fallback: true } as const;

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

  if (!sandboxAiEnabled()) return NextResponse.json(FALLBACK_BODY);

  try {
    const authorization = await consumeSandboxAiTurn(request, parsed.data.anonymousSessionId);
    if (authorization === 'unavailable') return NextResponse.json(FALLBACK_BODY);
    if (authorization === 'limited') return NextResponse.json(FALLBACK_BODY, { status: 429 });

    const result = await runCheckInTurn(parsed.data.state, parsed.data.message, {
      callModel: runLlmTurn,
    });

    // Simulated live call: attach per-message audio. Canonical lines resolve
    // to static clip refs (no cost); only dynamic lines (small-talk acks,
    // paraphrases) are synthesized. Completed turns keep the fixed
    // disposition clips the client already plays, so no synthesis there.
    if (parsed.data.wantSpeech && !result.done && !result.fallback) {
      const { scriptId, locale } = result.state;
      const speech: Array<SpeechItem | null> = await Promise.all(
        result.assistantMessages.map(async (message) => {
          const clipId = clipIdForText(message, scriptId, locale);
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
