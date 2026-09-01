import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runSimulatedCallMock, rpcMock } = vi.hoisted(() => ({
  runSimulatedCallMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock('@/lib/sandbox-ai/provider', () => ({ runSimulatedCall: runSimulatedCallMock }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: rpcMock } }));

import { POST } from '@/app/api/sandbox-ai/simulate-call/route';
import { emptyExtraction } from '@/lib/sandbox-ai/engine';
import { RED_FLAG_CRITERIA } from '@/lib/vitals/constants';

function simulateRequest(body: unknown = {}): Request {
  return new Request('http://localhost/api/sandbox-ai/simulate-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.7' },
    body: JSON.stringify(body),
  });
}

const GENERATED_TURNS = Array.from({ length: 8 }, (_, index) => ({
  speaker: index % 2 === 0 ? ('assistant' as const) : ('patient' as const),
  text: `Synthetic call line ${index + 1}.`,
}));

beforeEach(() => {
  vi.stubEnv('SANDBOX_AI_ENABLED', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  vi.stubEnv('ACCESS_REQUEST_RATE_LIMIT_SECRET', 'test-secret');
  // Deterministic scenario pick: index 1 -> scenario-weight-gain.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('POST /api/sandbox-ai/simulate-call', () => {
  it('answers fallback without touching the rate limiter when disabled', async () => {
    vi.stubEnv('SANDBOX_AI_ENABLED', 'false');
    const response = await POST(simulateRequest());
    expect(await response.json()).toEqual({ fallback: true });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('bills three turns and stops with 429 when the budget runs out mid-call', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const response = await POST(simulateRequest());
    expect(response.status).toBe(429);
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(runSimulatedCallMock).not.toHaveBeenCalled();
  });

  it('derives the disposition from the deterministic rules, never from the model', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    runSimulatedCallMock.mockResolvedValueOnce({
      turns: GENERATED_TURNS,
      // Weight-gain persona reports ~4 lbs up vs 2 days ago -> 3lb/2d rule fires.
      extracted: { ...emptyExtraction(), weightLbs: 214, dyspnea: 1, edema: 1, adherence: 'yes', chestPainOrSyncope: false },
    });

    const response = await POST(simulateRequest());
    expect(response.status).toBe(200);
    const { transcript } = await response.json();
    expect(rpcMock).toHaveBeenCalledTimes(3);
    expect(transcript.id).toMatch(/^ai-run-[0-9a-f-]{1,12}$/);
    expect(transcript.patientId).toBeNull();
    expect(transcript.disposition).toBe('escalated');
    expect(transcript.redFlags.map((flag: { id: string }) => flag.id)).toContain(RED_FLAG_CRITERIA.weight_gain_3lb_2d.id);
  });

  it('routes a chest-pain mention straight to the emergency disposition', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    runSimulatedCallMock.mockResolvedValueOnce({
      turns: GENERATED_TURNS,
      extracted: { ...emptyExtraction(), chestPainOrSyncope: true },
    });

    const { transcript } = await (await POST(simulateRequest())).json();
    expect(transcript.disposition).toBe('emergency');
    expect(transcript.redFlags).toEqual([]);
  });

  it('overrides a model false negative when the patient transcript says chest pain', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const turns = GENERATED_TURNS.map((turn, index) => index === 3
      ? { ...turn, text: 'I have crushing chest pain right now.' }
      : turn);
    runSimulatedCallMock.mockResolvedValueOnce({
      turns,
      extracted: {
        ...emptyExtraction(),
        weightLbs: 188,
        dyspnea: 0,
        edema: 0,
        orthopnea: false,
        fatigue: 0,
        adherence: 'yes',
        chestPainOrSyncope: false,
      },
    });

    const { transcript } = await (await POST(simulateRequest())).json();
    expect(transcript.disposition).toBe('emergency');
    expect(transcript.extraction.chestPainOrSyncope).toBe(true);
    expect(transcript.redFlags).toEqual([]);
  });

  it('routes missing generated clinical answers to human review, never routine', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    runSimulatedCallMock.mockResolvedValueOnce({
      turns: GENERATED_TURNS,
      extracted: { ...emptyExtraction(), chestPainOrSyncope: false },
    });

    const { transcript } = await (await POST(simulateRequest())).json();
    expect(transcript.disposition).toBe('escalated');
    expect(transcript.redFlags.map((flag: { id: string }) => flag.id)).toContain('needs_human_review');
  });

  it('degrades to fallback when generation fails after billing', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    runSimulatedCallMock.mockResolvedValueOnce(null);
    const response = await POST(simulateRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fallback: true });
  });
});
