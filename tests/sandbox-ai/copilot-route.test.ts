import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runCopilotMock, rpcMock } = vi.hoisted(() => ({
  runCopilotMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock('@/lib/sandbox-ai/provider', () => ({ runCopilot: runCopilotMock }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: rpcMock } }));

import { POST } from '@/app/api/sandbox-ai/copilot/route';

function copilotRequest(body: unknown): Request {
  return new Request('http://localhost/api/sandbox-ai/copilot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.7' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  question: 'Who should I call first?',
  snapshot: { workItems: [{ id: 'a', patientName: 'Maria Santos (synthetic)', disposition: 'escalated', redFlagMessages: [], atLabel: '07:15' }] },
};

beforeEach(() => {
  vi.stubEnv('SANDBOX_AI_ENABLED', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  vi.stubEnv('ACCESS_REQUEST_RATE_LIMIT_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/sandbox-ai/copilot', () => {
  it('rejects malformed bodies with a generic 400', async () => {
    const response = await POST(copilotRequest({ question: 'hi', snapshot: { hacked: true } }));
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('draws from the dedicated copilot bucket', async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    const response = await POST(copilotRequest(validBody));
    expect(response.status).toBe(429);
    expect(rpcMock.mock.calls[0][0]).toBe('consume_sandbox_ai_turn_v2');
    expect(rpcMock.mock.calls[0][1].p_kind).toBe('copilot');
    expect(runCopilotMock).not.toHaveBeenCalled();
  });

  it('answers fallback when disabled and when the agent fails', async () => {
    vi.stubEnv('SANDBOX_AI_ENABLED', 'false');
    expect(await (await POST(copilotRequest(validBody))).json()).toEqual({ fallback: true });

    vi.stubEnv('SANDBOX_AI_ENABLED', 'true');
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    runCopilotMock.mockResolvedValueOnce(null);
    expect(await (await POST(copilotRequest(validBody))).json()).toEqual({ fallback: true });
  });

  it('returns the agent answer with its tool trace on the happy path', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    runCopilotMock.mockResolvedValueOnce({
      answer: 'Call Maria Santos first — rule weight_gain_5lb_7d.',
      toolTrace: [{ tool: 'get_queue', summary: 'queue (1 items)' }],
    });
    const body = await (await POST(copilotRequest(validBody))).json();
    expect(body.answer).toContain('Maria Santos');
    expect(body.toolTrace).toHaveLength(1);
  });
});
