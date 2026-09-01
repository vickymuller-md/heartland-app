/**
 * Live smoke test for the voice check-in path (S7). Opt-in, never in CI.
 *
 * Hits a RUNNING dev/preview server through the real public endpoint — the
 * exact production driver: route guards, rate limit RPC, Sonnet turn, and
 * runtime TTS. Requires the server to run with SANDBOX_AI_ENABLED=true,
 * ANTHROPIC_API_KEY, SANDBOX_TTS_ENABLED=true, and ELEVENLABS_API_KEY.
 *
 *   npm run ai:smoke                      # against http://localhost:3000
 *   npm run ai:smoke -- https://host.tld  # against a preview deploy
 */

import { randomUUID } from 'node:crypto';

const BASE_URL = process.argv[2]?.replace(/\/$/, '') ?? 'http://localhost:3000';

const SMALL_TALK_MESSAGE =
  'No chest pain at all. My grandson visited yesterday and we baked a pie together — such a lovely day!';

async function main() {
  const state = {
    patientId: 'demo-maria',
    scriptId: 'daily_checkin',
    locale: 'en',
    phase: 'q1_safety',
    extraction: {
      weightLbs: null, sbp: null, spo2: null, dyspnea: null, edema: null,
      orthopnea: null, fatigue: null, adherence: null, chestPainOrSyncope: null,
      hr: null, dizziness: null, worseSymptoms: null,
    },
    reasksUsed: {},
    turnCount: 0,
  };

  const startedAt = Date.now();
  const response = await fetch(`${BASE_URL}/api/sandbox-ai/checkin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      state,
      message: SMALL_TALK_MESSAGE,
      anonymousSessionId: randomUUID(),
      wantSpeech: true,
    }),
  });

  // Two-phase NDJSON: line 1 = the turn (text lands here — the latency the
  // caller feels); line 2 = the synthesized speech. Plain JSON still parses.
  type TurnBody = {
    fallback?: boolean;
    assistantMessages?: string[];
    speech?: Array<{ kind: string; clipId?: string; mp3Base64?: string } | null>;
    state?: { phase: string };
  };
  let body: TurnBody;
  let textMs = 0;
  let audioMs = 0;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('ndjson') && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    const lines: string[] = [];
    while (lines.length < 2) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const parts = buffered.split('\n');
      buffered = parts.pop() ?? '';
      for (const part of parts) {
        if (part.trim().length === 0) continue;
        lines.push(part);
        if (lines.length === 1) textMs = Date.now() - startedAt;
      }
    }
    audioMs = Date.now() - startedAt;
    body = JSON.parse(lines[0]) as TurnBody;
    const phase2 = lines[1] ? (JSON.parse(lines[1]) as { speech?: TurnBody['speech'] }) : null;
    if (phase2?.speech) body.speech = phase2.speech;
  } else {
    body = await response.json() as TurnBody;
    textMs = audioMs = Date.now() - startedAt;
  }
  const latencyMs = audioMs;

  console.log(`POST ${BASE_URL}/api/sandbox-ai/checkin -> ${response.status} · text in ${textMs} ms · audio in ${audioMs} ms`);

  if (body.fallback || !body.state) {
    console.error('FAIL: endpoint answered with the deterministic fallback.');
    console.error('Check the server env: SANDBOX_AI_ENABLED, ANTHROPIC_API_KEY, Supabase rate-limit RPC.');
    process.exit(1);
  }

  console.log(`next phase: ${body.state.phase}`);
  for (const [index, message] of (body.assistantMessages ?? []).entries()) {
    const item = body.speech?.[index] ?? null;
    const voiced = item === null
      ? 'text-only'
      : item.kind === 'clip'
        ? `clip:${item.clipId}`
        : `synthesized ${Math.round((item.mp3Base64?.length ?? 0) * 0.75 / 1024)} KB`;
    console.log(`  [${voiced}] ${message}`);
  }

  if ((body.assistantMessages?.length ?? 0) < 2) {
    console.warn('WARN: the model did not treat the reply as small talk (single message). Not fatal — retry or adjust the message.');
  }
  const synthesized = (body.speech ?? []).some((item) => item?.kind === 'audio' && (item.mp3Base64?.length ?? 0) > 0);
  if (!synthesized) {
    console.error('FAIL: no synthesized audio in the response. Check SANDBOX_TTS_ENABLED and ELEVENLABS_API_KEY on the server.');
    process.exit(1);
  }

  console.log(`OK: real Sonnet turn + real runtime TTS in ${latencyMs} ms.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
