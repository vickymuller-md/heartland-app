import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runAssistMock, rpcMock } = vi.hoisted(() => ({
  runAssistMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock('@/lib/sandbox-ai/provider', () => ({ runAssist: runAssistMock }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: rpcMock } }));

import { POST } from '@/app/api/sandbox-ai/assist/route';

function assistRequest(body: unknown): Request {
  return new Request('http://localhost/api/sandbox-ai/assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.7' },
    body: JSON.stringify(body),
  });
}

const validBody = { kind: 'protocol_qa', input: { question: 'What is the Generic Bridge?' } };

beforeEach(() => {
  vi.stubEnv('SANDBOX_AI_ENABLED', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  vi.stubEnv('ACCESS_REQUEST_RATE_LIMIT_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/sandbox-ai/assist', () => {
  it('rejects malformed bodies with a generic 400', async () => {
    const response = await POST(assistRequest({ kind: 'protocol_qa', input: { hacked: true } }));
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('answers fallback without touching the rate limiter when disabled', async () => {
    vi.stubEnv('SANDBOX_AI_ENABLED', 'false');
    const response = await POST(assistRequest(validBody));
    expect(await response.json()).toEqual({ fallback: true });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('shares the check-in budget: 429 fallback when the cap is exhausted', async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    const response = await POST(assistRequest(validBody));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ fallback: true });
    expect(runAssistMock).not.toHaveBeenCalled();
    expect(rpcMock.mock.calls[0][0]).toBe('consume_sandbox_ai_turn_v2');
    expect(rpcMock.mock.calls[0][1].p_kind).toBe('turn');
  });

  it('degrades to fallback when the rate-limit RPC errors or the model fails', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    expect(await (await POST(assistRequest(validBody))).json()).toEqual({ fallback: true });

    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    runAssistMock.mockResolvedValueOnce(null);
    expect(await (await POST(assistRequest(validBody))).json()).toEqual({ fallback: true });
  });

  it('returns the validated assist result on the happy path', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    runAssistMock.mockResolvedValueOnce({
      kind: 'protocol_qa',
      answer: 'The Generic Bridge is described in Module 2.',
      citations: ['Module 2 §2.4'],
    });

    const response = await POST(assistRequest({ ...validBody, anonymousSessionId: '3b241101-e2bb-4255-8caf-4136c566a962' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kind).toBe('protocol_qa');
    expect(body.citations).toEqual(['Module 2 §2.4']);
    expect(runAssistMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'protocol_qa' }));
  });
});

describe('generated protocol content freshness', () => {
  it('matches the source markdown (run npm run sync:protocol after editing it)', async () => {
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const { PROTOCOL_CONTENT, PROTOCOL_CONTENT_HASH } = await import('@/lib/sandbox-ai/protocol-content.generated');
    const source = readFileSync('reference/clinical_content.md', 'utf8');
    expect(PROTOCOL_CONTENT).toBe(source);
    expect(createHash('sha256').update(source).digest('hex').slice(0, 16)).toBe(PROTOCOL_CONTENT_HASH);
  });
});
