import { NextResponse } from 'next/server';
import { assistRequestSchema } from '@/lib/sandbox-ai/assist';
import { runAssist } from '@/lib/sandbox-ai/provider';
import { consumeSandboxAiTurn, sandboxAiEnabled } from '@/lib/sandbox-ai/rate-limit';

export const dynamic = 'force-dynamic';
// TTS synthesis on top of the model call can pass the platform default.
export const maxDuration = 30;

// Never 500 with detail: every assist surface hides itself or keeps its
// deterministic content on any server-side failure (engine, RPC, or vendor).
const FALLBACK_BODY = { fallback: true } as const;

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = assistRequestSchema.safeParse(await request.json());
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

    const result = await runAssist(parsed.data);
    if (!result) return NextResponse.json(FALLBACK_BODY);

    // Copilot morning brief: optionally speak the drafted text (best-effort).
    if (result.kind === 'morning_brief' && parsed.data.kind === 'morning_brief' && parsed.data.wantSpeech) {
      const { synthesizeSpeech } = await import('@/lib/sandbox-ai/tts');
      const mp3Base64 = await synthesizeSpeech(result.brief);
      return NextResponse.json(mp3Base64 ? { ...result, mp3Base64 } : result);
    }
    return NextResponse.json(result);
  } catch {
    console.error('[sandbox-ai] assist failed');
    return NextResponse.json(FALLBACK_BODY);
  }
}
