import { createHmac, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { evaluateRedFlags } from '@/lib/vitals/red-flags';
import {
  SIMULATED_CALL_SCENARIOS,
  scenarioWeightHistory,
  type SimulatedCallTranscript,
} from '@/lib/sandbox-ai/fixtures';
import { runSimulatedCall } from '@/lib/sandbox-ai/provider';
import { simulateCallRequestSchema } from '@/lib/sandbox-ai/schema';

export const dynamic = 'force-dynamic';

const FALLBACK_BODY = { fallback: true } as const;

// One simulated call bills as 3 turns of the shared budget (larger generation).
const TURN_COST = 3;

function requestClientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('x-real-ip')?.trim() || forwarded || 'unknown';
}

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = simulateCallRequestSchema.safeParse(await request.json());
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
    for (let i = 0; i < TURN_COST; i += 1) {
      const { data: allowed, error } = await supabaseAdmin.rpc('consume_sandbox_ai_turn', {
        p_requester_hash: requesterHash,
        p_session_hash: sessionHash,
      });
      if (error) {
        console.error('[sandbox-ai] rate-limit RPC unavailable');
        return NextResponse.json(FALLBACK_BODY);
      }
      if (allowed !== true) return NextResponse.json(FALLBACK_BODY, { status: 429 });
    }

    const scenario = SIMULATED_CALL_SCENARIOS[Math.floor(Math.random() * SIMULATED_CALL_SCENARIOS.length)];
    const generated = await runSimulatedCall(scenario);
    if (!generated) return NextResponse.json(FALLBACK_BODY);

    // Disposition comes from the deterministic rules alone, never from the model.
    const extraction = { ...generated.extracted };
    const history = scenarioWeightHistory(scenario);
    const redFlags = extraction.chestPainOrSyncope === true
      ? []
      : evaluateRedFlags(
        {
          weight_lbs: extraction.weightLbs ?? history[0]?.weight_lbs ?? 0,
          sbp: extraction.sbp ?? scenario.baselineSbp,
          spo2: extraction.spo2,
        },
        history,
        {
          dyspnea: extraction.dyspnea ?? 0,
          edema: extraction.edema ?? 0,
          orthopnea: extraction.orthopnea ?? false,
          fatigue: extraction.fatigue ?? 0,
        },
      );
    const disposition = extraction.chestPainOrSyncope === true
      ? 'emergency'
      : redFlags.length > 0 ? 'escalated' : 'routine';

    const transcript: SimulatedCallTranscript = {
      id: `ai-run-${randomUUID().slice(0, 8)}`,
      patientId: null,
      patientName: scenario.patientName,
      channel: 'automated-voice-simulation',
      placedLabel: 'This visit · just now',
      turns: generated.turns,
      extraction,
      redFlags,
      disposition,
    };
    return NextResponse.json({ transcript });
  } catch {
    console.error('[sandbox-ai] simulated call failed');
    return NextResponse.json(FALLBACK_BODY);
  }
}
