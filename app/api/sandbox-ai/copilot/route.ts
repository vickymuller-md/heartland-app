import { NextResponse } from 'next/server';
import { copilotRequestSchema } from '@/lib/sandbox-ai/copilot';
import { runCopilot } from '@/lib/sandbox-ai/provider';
import { consumeSandboxAiTurn, sandboxAiEnabled } from '@/lib/sandbox-ai/rate-limit';

export const dynamic = 'force-dynamic';
// Tool-use loop can span several model rounds; the platform default would cut it off.
export const maxDuration = 60;

// Never 500 with detail: the copilot chat hides itself on any server-side
// failure (engine, RPC, or vendor) — the deterministic queue is unaffected.
const FALLBACK_BODY = { fallback: true } as const;

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = copilotRequestSchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!sandboxAiEnabled()) return NextResponse.json(FALLBACK_BODY);

  try {
    // One question = one unit of the copilot bucket, regardless of tool rounds.
    const authorization = await consumeSandboxAiTurn(request, parsed.data.anonymousSessionId, 'copilot');
    if (authorization === 'unavailable') return NextResponse.json(FALLBACK_BODY);
    if (authorization === 'limited') return NextResponse.json(FALLBACK_BODY, { status: 429 });

    const result = await runCopilot({
      question: parsed.data.question,
      snapshot: parsed.data.snapshot,
      dayIndex: parsed.data.dayIndex,
      populationSize: parsed.data.populationSize,
    });
    if (!result) return NextResponse.json(FALLBACK_BODY);
    return NextResponse.json(result);
  } catch {
    console.error('[sandbox-ai] copilot failed');
    return NextResponse.json(FALLBACK_BODY);
  }
}
