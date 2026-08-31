import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runLlmTurnMock, rpcMock } = vi.hoisted(() => ({
  runLlmTurnMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock('@/lib/sandbox-ai/provider', () => ({ runLlmTurn: runLlmTurnMock }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: rpcMock } }));

import { POST } from '@/app/api/sandbox-ai/checkin/route';
import { createInitialState, emptyExtraction } from '@/lib/sandbox-ai/engine';
import { SCRIPT_QUESTIONS } from '@/lib/sandbox-ai/script';

function checkInRequest(body: unknown): Request {
  return new Request('http://localhost/api/sandbox-ai/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.7' },
    body: JSON.stringify(body),
  });
}

const validBody = { state: createInitialState('demo-maria'), message: 'no chest pain' };

beforeEach(() => {
  vi.stubEnv('SANDBOX_AI_ENABLED', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  vi.stubEnv('ACCESS_REQUEST_RATE_LIMIT_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('POST /api/sandbox-ai/checkin', () => {
  it('rejects malformed bodies with a generic 400', async () => {
    const response = await POST(checkInRequest({ state: { hacked: true }, message: 'hi' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid request' });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('answers fallback without touching the rate limiter when the feature is disabled', async () => {
    vi.stubEnv('SANDBOX_AI_ENABLED', 'false');
    const response = await POST(checkInRequest(validBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fallback: true });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('answers fallback when no API key is configured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const response = await POST(checkInRequest(validBody));
    expect(await response.json()).toEqual({ fallback: true });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('returns 429 fallback when a turn cap is exhausted', async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    const response = await POST(checkInRequest(validBody));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ fallback: true });
    expect(runLlmTurnMock).not.toHaveBeenCalled();
  });

  it('degrades to fallback when the rate-limit RPC errors', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    const response = await POST(checkInRequest(validBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fallback: true });
  });

  it('runs a turn and returns the engine response on the happy path', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    runLlmTurnMock.mockResolvedValueOnce({
      say: { kind: 'question', paraphrase: 'And what did the scale show today?', smallTalk: null },
      extracted: { ...emptyExtraction(), unclear: false, chestPainOrSyncope: false },
    });

    const response = await POST(checkInRequest({
      ...validBody,
      anonymousSessionId: '3b241101-e2bb-4255-8caf-4136c566a962',
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.fallback).toBe(false);
    expect(body.state.phase).toBe('q2_weight');
    expect(body.done).toBe(false);
    expect(body.speech).toBeUndefined();

    const [, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcMock.mock.calls[0][0]).toBe('consume_sandbox_ai_turn_v2');
    expect(rpcArgs.p_kind).toBe('turn');
    expect(rpcArgs.p_requester_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rpcArgs.p_session_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('attaches clip refs for canonical lines and synthesized audio for dynamic ones', async () => {
    vi.stubEnv('SANDBOX_TTS_ENABLED', 'true');
    vi.stubEnv('ELEVENLABS_API_KEY', 'el-key');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('mp3').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    runLlmTurnMock.mockResolvedValueOnce({
      say: {
        kind: 'small_talk',
        paraphrase: SCRIPT_QUESTIONS.q2_weight.canonical,
        smallTalk: 'What a treat to have your grandson visit.',
      },
      extracted: { ...emptyExtraction(), unclear: false, chestPainOrSyncope: false },
    });

    const response = await POST(checkInRequest({ ...validBody, wantSpeech: true }));
    const body = await response.json();
    expect(body.assistantMessages).toEqual([
      'What a treat to have your grandson visit.',
      SCRIPT_QUESTIONS.q2_weight.canonical,
    ]);
    expect(body.speech).toEqual([
      { kind: 'audio', mp3Base64: Buffer.from('mp3').toString('base64') },
      { kind: 'clip', clipId: 'q2_weight' },
    ]);
    // Only the dynamic line is synthesized; canonical lines stay static clips.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves dynamic lines text-only when the TTS kill switch is off', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    runLlmTurnMock.mockResolvedValueOnce({
      say: {
        kind: 'small_talk',
        paraphrase: SCRIPT_QUESTIONS.q2_weight.canonical,
        smallTalk: 'What a treat to have your grandson visit.',
      },
      extracted: { ...emptyExtraction(), unclear: false, chestPainOrSyncope: false },
    });

    const response = await POST(checkInRequest({ ...validBody, wantSpeech: true }));
    const body = await response.json();
    expect(body.speech).toEqual([null, { kind: 'clip', clipId: 'q2_weight' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
