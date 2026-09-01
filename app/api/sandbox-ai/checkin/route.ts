import { NextResponse } from 'next/server';
import { clipIdForText } from '@/lib/sandbox-ai/call-prompts';
import { runCheckInTurn } from '@/lib/sandbox-ai/engine';
import { runLlmTurn } from '@/lib/sandbox-ai/provider';
import { consumeSandboxAiTurn, sandboxAiEnabled } from '@/lib/sandbox-ai/rate-limit';
import { checkInRequestSchema } from '@/lib/sandbox-ai/schema';
import { synthesizeSpeech } from '@/lib/sandbox-ai/tts';
import type { SpeechItem } from '@/lib/sandbox-ai/types';

export const dynamic = 'force-dynamic';
// Model turn plus runtime synthesis can pass the platform default.
export const maxDuration = 60;

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

    const llmStartedAt = Date.now();
    const result = await runCheckInTurn(parsed.data.state, parsed.data.message, {
      callModel: runLlmTurn,
    });
    const llmMs = Date.now() - llmStartedAt;

    // Simulated live call: attach per-message audio. Canonical lines resolve
    // to static clip refs (no cost); dynamic lines (small-talk acks,
    // paraphrases) are synthesized — including on the FINAL turn, except its
    // last message: that closing is covered by the fixed disposition clip the
    // client already plays.
    if (parsed.data.wantSpeech && !result.fallback) {
      const { scriptId, locale } = result.state;
      const synthesizable = (index: number) =>
        !result.done || index < result.assistantMessages.length - 1;
      const partial: Array<SpeechItem | null> = result.assistantMessages.map((message, index) => {
        if (!synthesizable(index)) return null;
        const clipId = clipIdForText(message, scriptId, locale);
        if (clipId) return { kind: 'clip' as const, clipId };
        return { kind: 'pending' as const };
      });

      if (!partial.some((item) => item?.kind === 'pending')) {
        console.log(`[sandbox-ai] turn llm=${llmMs}ms tts=0ms (clips only)`);
        return NextResponse.json({ ...result, speech: partial });
      }

      // Two-phase NDJSON: line 1 ships the text (and resolved clips) the
      // moment the model is done; line 2 fills the synthesized audio in. The
      // client shows the reply immediately while the spoken filler covers
      // the synthesis gap.
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ ...result, speech: partial })}\n`));
          const ttsStartedAt = Date.now();
          let speech: Array<SpeechItem | null>;
          try {
            speech = await Promise.all(
              result.assistantMessages.map(async (message, index) => {
                const item = partial[index];
                if (item?.kind !== 'pending') return item;
                const mp3Base64 = await synthesizeSpeech(message);
                return mp3Base64 ? { kind: 'audio' as const, mp3Base64 } : null;
              }),
            );
          } catch {
            speech = partial.map((item) => (item?.kind === 'pending' ? null : item));
          }
          console.log(`[sandbox-ai] turn llm=${llmMs}ms tts=${Date.now() - ttsStartedAt}ms`);
          controller.enqueue(encoder.encode(`${JSON.stringify({ speech })}\n`));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    console.log(`[sandbox-ai] turn llm=${llmMs}ms`);
    return NextResponse.json(result);
  } catch {
    console.error('[sandbox-ai] turn failed');
    return NextResponse.json(FALLBACK_BODY);
  }
}
