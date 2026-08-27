import { afterEach, describe, expect, it, vi } from 'vitest';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  // Must be construible: the provider instantiates the SDK with `new`.
  default: vi.fn(function AnthropicMock() {
    return { messages: { create: createMock } };
  }),
}));

import { runLlmTurn } from '@/lib/sandbox-ai/provider';
import { SCRIPT_QUESTIONS } from '@/lib/sandbox-ai/script';

const turnInput = {
  currentQuestion: SCRIPT_QUESTIONS.q1_safety,
  nextQuestion: SCRIPT_QUESTIONS.q2_weight,
  reasksUsed: 0,
  visitorReply: 'no chest pain today',
};

const validToolInput = {
  say: { kind: 'question', paraphrase: 'What did the scale show today?', smallTalk: null },
  extracted: {
    weightLbs: null, sbp: null, spo2: null, dyspnea: null, edema: null,
    orthopnea: null, fatigue: null, adherence: null, chestPainOrSyncope: false,
    unclear: false,
  },
};

afterEach(() => vi.clearAllMocks());

describe('runLlmTurn', () => {
  it('returns the validated turn from a forced tool call', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'tool_use', name: 'check_in_turn', input: validToolInput }],
    });
    const turn = await runLlmTurn(turnInput);
    expect(turn?.extracted.chestPainOrSyncope).toBe(false);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      tool_choice: { type: 'tool', name: 'check_in_turn' },
      max_tokens: 400,
    }));
  });

  it('returns null when the tool payload does not match the strict schema', async () => {
    createMock.mockResolvedValueOnce({
      content: [{
        type: 'tool_use',
        name: 'check_in_turn',
        input: { ...validToolInput, extracted: { ...validToolInput.extracted, freeText: 'hello' } },
      }],
    });
    expect(await runLlmTurn(turnInput)).toBeNull();
  });

  it('returns null when the response has no tool call', async () => {
    createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: 'plain prose' }] });
    expect(await runLlmTurn(turnInput)).toBeNull();
  });

  it('returns null on any API failure without retrying', async () => {
    createMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await runLlmTurn(turnInput)).toBeNull();
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
