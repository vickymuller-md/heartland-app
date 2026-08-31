import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { evaluateRedFlags } from '@/lib/vitals/red-flags';
import {
  SIMULATED_CALL_SCENARIOS,
  scenarioWeightHistory,
  type SimulatedCallTranscript,
} from '@/lib/sandbox-ai/fixtures';
import { runSimulatedCall } from '@/lib/sandbox-ai/provider';
import { consumeSandboxAiTurn, sandboxAiEnabled } from '@/lib/sandbox-ai/rate-limit';
import { simulateCallRequestSchema } from '@/lib/sandbox-ai/schema';

export const dynamic = 'force-dynamic';
// First uncached one-shot generation regularly passes 15s; keep headroom.
export const maxDuration = 45;

const FALLBACK_BODY = { fallback: true } as const;

// One simulated call bills as 3 turns of the shared budget (larger generation).
const TURN_COST = 3;

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

  if (!sandboxAiEnabled()) return NextResponse.json(FALLBACK_BODY);

  try {
    for (let i = 0; i < TURN_COST; i += 1) {
      const authorization = await consumeSandboxAiTurn(request, parsed.data.anonymousSessionId);
      if (authorization === 'unavailable') return NextResponse.json(FALLBACK_BODY);
      if (authorization === 'limited') return NextResponse.json(FALLBACK_BODY, { status: 429 });
    }

    const scenario = (parsed.data.scenarioId
      ? SIMULATED_CALL_SCENARIOS.find((entry) => entry.id === parsed.data.scenarioId)
      : undefined)
      ?? SIMULATED_CALL_SCENARIOS[Math.floor(Math.random() * SIMULATED_CALL_SCENARIOS.length)];
    const generated = await runSimulatedCall(scenario);
    if (!generated) return NextResponse.json(FALLBACK_BODY);

    // Disposition comes from the deterministic rules alone, never from the model.
    // Normalize to the full extraction shape (titration-only fields stay null).
    const extraction = { hr: null, dizziness: null, worseSymptoms: null, ...generated.extracted };
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
