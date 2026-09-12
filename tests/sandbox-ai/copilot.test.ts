import { afterEach, describe, expect, it, vi } from 'vitest';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: vi.fn(function AnthropicMock() {
    return { messages: { create: createMock } };
  }),
}));

import {
  copilotRequestSchema,
  COPILOT_PROMPT,
  executeCopilotTool,
  type CopilotWorkItem,
} from '@/lib/sandbox-ai/copilot';
import { runCopilot } from '@/lib/sandbox-ai/provider';

const ITEMS: CopilotWorkItem[] = [
  { id: 'a', patientName: 'James Tallchief (synthetic)', disposition: 'routine', redFlagMessages: [], atLabel: '07:30' },
  { id: 'b', patientName: 'Maria Santos (synthetic)', disposition: 'escalated', redFlagMessages: ['Weight gain of 5+ lbs in 1 week detected'], atLabel: '07:15' },
  { id: 'c', patientName: 'Robert Yellowhorse (synthetic)', disposition: 'no_answer', redFlagMessages: [], atLabel: '07:40' },
];

afterEach(() => vi.clearAllMocks());

describe('copilotRequestSchema', () => {
  it('keeps out-of-contract stress sizes and excess visit counts out of public requests', () => {
    const request = { question: 'What happened?', snapshot: { workItems: [] } };
    expect(copilotRequestSchema.safeParse({ ...request, populationSize: 10000 }).success).toBe(false);
    expect(copilotRequestSchema.safeParse({ ...request, populationSize: 5000, reviewedCount: 40 }).success).toBe(true);
    expect(copilotRequestSchema.safeParse({ ...request, reviewedCount: 41 }).success).toBe(false);
  });
  it('accepts a valid request and rejects oversized or extra input', () => {
    expect(copilotRequestSchema.safeParse({
      question: 'Who should I call first?',
      snapshot: { workItems: ITEMS },
    }).success).toBe(true);
    expect(copilotRequestSchema.safeParse({
      question: 'x'.repeat(301), snapshot: { workItems: ITEMS },
    }).success).toBe(false);
    expect(copilotRequestSchema.safeParse({
      question: 'ok?', snapshot: { workItems: ITEMS }, admin: true,
    }).success).toBe(false);
    expect(copilotRequestSchema.safeParse({
      question: 'ok?', snapshot: { workItems: Array.from({ length: 21 }, () => ITEMS[0]) },
    }).success).toBe(false);
  });
});

describe('executeCopilotTool', () => {
  it('orders the queue emergency → escalated → no_answer → routine deterministically', () => {
    const { result, trace } = executeCopilotTool('get_queue', {}, { workItems: ITEMS });
    const items = (result as { items: Array<{ patientName: string }> }).items;
    expect(items.map((item) => item.patientName)).toEqual([
      'Maria Santos (synthetic)', 'Robert Yellowhorse (synthetic)', 'James Tallchief (synthetic)',
    ]);
    expect((result as { orderNote: string }).orderNote).toContain('never by the assistant');
    expect(trace.summary).toBe('queue (3 items)');
  });

  it('returns tour patient snapshots by id or name and an error for unknown personas', () => {
    const byId = executeCopilotTool('get_patient_snapshot', { patient: 'demo-maria' }, { workItems: [] });
    expect((byId.result as { name: string }).name).toContain('Maria');
    const byName = executeCopilotTool('get_patient_snapshot', { patient: 'Maria Santos' }, { workItems: [] });
    expect((byName.result as { labs: unknown[] }).labs.length).toBeGreaterThan(0);
    const unknown = executeCopilotTool('get_patient_snapshot', { patient: 'Earl Hutchins' }, { workItems: [] });
    expect((unknown.result as { error: string }).error).toContain('Unknown tour patient');
  });

  it('serves the registered rule record raw, with known ids on a miss', () => {
    const known = executeCopilotTool('explain_rule', { ruleId: 'weight_gain_5lb_7d' }, { workItems: [] });
    expect((known.result as { rule: { threshold: number } }).rule.threshold).toBe(5);
    expect((known.result as { registryBoundary: string }).registryBoundary).toContain('Silent-mode validation');
    const miss = executeCopilotTool('explain_rule', { ruleId: 'nope' }, { workItems: [] });
    expect((miss.result as { knownRules: string[] }).knownRules).toContain('spo2_low');
  });

  it('drafts a deterministic SBAR for a tour patient and flags provider review', () => {
    const { result } = executeCopilotTool('draft_sbar', { patient: 'demo-james' }, { workItems: [] });
    const payload = result as { note: string; sbar: { situation: string } };
    expect(payload.note).toContain('provider review required');
    expect(payload.sbar.situation.length).toBeGreaterThan(10);
  });

  it('rejects unknown tools and invalid arguments without throwing', () => {
    expect(executeCopilotTool('rm_rf', {}, { workItems: [] }).result).toEqual({ error: 'unknown tool' });
    expect((executeCopilotTool('explain_rule', { nope: true }, { workItems: [] }).result as { error: string }).error)
      .toBe('invalid arguments');
  });
});

describe('runCopilot — bounded tool loop', () => {
  it('carries population uncertainty and limited examples through the mocked vendor boundary', async () => {
    createMock.mockResolvedValueOnce({ content: [{ type: 'tool_use', id: 'population', name: 'get_population_snapshot', input: {} }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Outside the queue is not resolved.' }] });
    await runCopilot({ question: 'Were all other cases resolved?', snapshot: { workItems: [] }, populationSize: 2500, reviewedCount: 40 });
    expect(COPILOT_PROMPT).toContain('outside the review queue does not mean resolved');
    expect(COPILOT_PROMPT).toContain('monitoring-gap policies');
    expect(COPILOT_PROMPT).toContain('not proof of human review');
    expect(COPILOT_PROMPT).toContain('Never infer staffing capacity');
    const first = createMock.mock.calls[0][0];
    expect(first.system[0].text).toBe(COPILOT_PROMPT);
    const transported = createMock.mock.calls[1][0].messages[2].content[0].content;
    const parsed = JSON.parse(transported);
    expect(parsed).not.toHaveProperty('error');
    expect(parsed.counts.reviewQueue).toBe(47);
    expect(parsed.clientReportedSyntheticSelections).toBe(40);
    expect(parsed.note).toContain('outside is not resolved');
    expect(parsed.note).toContain('no human review or delivered care');
  });
  it('executes tool rounds and returns the sanitized final answer with the trace', async () => {
    createMock
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu1', name: 'get_queue', input: {} }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Call Maria Santos first — rule weight_gain_5lb_7d fired at 07:15.' }],
      });

    const result = await runCopilot({ question: 'Who first?', snapshot: { workItems: ITEMS } });
    expect(result?.answer).toContain('Maria Santos first');
    expect(result?.toolTrace).toEqual([{ tool: 'get_queue', summary: 'queue (3 items)' }]);
    expect(createMock).toHaveBeenCalledTimes(2);
    // The second call carries the tool result back to the model.
    const secondMessages = createMock.mock.calls[1][0].messages;
    expect(secondMessages).toHaveLength(3);
    expect(JSON.stringify(secondMessages[2].content)).toContain('never by the assistant');
  });

  it('gives up after the round budget and on vendor errors', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu', name: 'get_queue', input: {} }],
    });
    expect(await runCopilot({ question: 'loop?', snapshot: { workItems: ITEMS } })).toBeNull();
    expect(createMock).toHaveBeenCalledTimes(6);

    createMock.mockReset();
    createMock.mockRejectedValueOnce(new Error('down'));
    expect(await runCopilot({ question: 'err?', snapshot: { workItems: ITEMS } })).toBeNull();
  });
});
