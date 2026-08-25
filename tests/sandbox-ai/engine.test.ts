import { describe, expect, it, vi } from 'vitest';
import {
  MAX_TURNS,
  createInitialState,
  emptyExtraction,
  finalizeCheckIn,
  runCheckInTurn,
} from '@/lib/sandbox-ai/engine';
import {
  DEFLECT_MESSAGE,
  EMERGENCY_911_MESSAGE,
  QUESTION_ORDER,
  SCRIPT_QUESTIONS,
} from '@/lib/sandbox-ai/script';
import { RED_FLAG_CRITERIA } from '@/lib/vitals/constants';
import type { CheckInExtraction, CheckInState, LlmTurn } from '@/lib/sandbox-ai/types';

function llmTurn(extracted: Partial<CheckInExtraction & { unclear: boolean }>, say?: Partial<LlmTurn['say']>): LlmTurn {
  return {
    say: { kind: 'question', paraphrase: 'Here is the next question, ok?', ...say },
    extracted: { ...emptyExtraction(), unclear: false, ...extracted },
  };
}

function stateAt(phase: CheckInState['phase'], extraction: Partial<CheckInExtraction> = {}): CheckInState {
  return {
    ...createInitialState('demo-james'),
    phase,
    extraction: { ...emptyExtraction(), ...extraction },
  };
}

const CLEAR_ANSWERS: Record<string, Partial<CheckInExtraction>> = {
  q1_safety: { chestPainOrSyncope: false },
  q2_weight: { weightLbs: 188 },
  q3_breathing: { dyspnea: 0 },
  q4_swelling: { edema: 0 },
  q5_orthopnea: { orthopnea: false },
  q6_fatigue: { fatigue: 0 },
  q7_adherence: { adherence: 'yes' },
  q8_devices: {},
};

describe('runCheckInTurn — deterministic control', () => {
  it('advances through the full script in the fixed order and finishes routine', async () => {
    const asked: string[] = [];
    const callModel = vi.fn(async (input: { currentQuestion: { id: string } }) => {
      asked.push(input.currentQuestion.id);
      return llmTurn(CLEAR_ANSWERS[input.currentQuestion.id]);
    });

    let state = createInitialState('demo-james');
    let response;
    for (let i = 0; i < QUESTION_ORDER.length; i += 1) {
      response = await runCheckInTurn(state, 'a clear answer', { callModel });
      state = response.state;
    }

    expect(asked).toEqual([...QUESTION_ORDER]);
    expect(response?.done).toBe(true);
    expect(response?.disposition).toBe('routine');
    expect(response?.redFlags).toEqual([]);
    expect(response?.assistantMessages[0]).toContain('Nothing you reported needs urgent attention');
  });

  it('short-circuits to the emergency template when chest pain appears mid-conversation', async () => {
    const callModel = vi.fn(async () => llmTurn({ dyspnea: 1, chestPainOrSyncope: true }));
    const response = await runCheckInTurn(stateAt('q3_breathing'), 'my chest hurts a bit too', { callModel });

    expect(response.done).toBe(true);
    expect(response.disposition).toBe('emergency');
    expect(response.assistantMessages).toEqual([EMERGENCY_911_MESSAGE]);
    expect(response.state.phase).toBe('complete');
  });

  it('deflects off-topic requests and repeats the current question without advancing', async () => {
    const callModel = vi.fn(async () => llmTurn({ unclear: true }, { kind: 'deflect_question' }));
    const response = await runCheckInTurn(stateAt('q4_swelling'), 'what dose should I take?', { callModel });

    expect(response.assistantMessages).toEqual([DEFLECT_MESSAGE, SCRIPT_QUESTIONS.q4_swelling.canonical]);
    expect(response.state.phase).toBe('q4_swelling');
    expect(response.done).toBe(false);
  });

  it('re-asks an unclear answer once, then advances with the field left null', async () => {
    const callModel = vi.fn(async () => llmTurn({ unclear: true }));

    const first = await runCheckInTurn(stateAt('q2_weight'), 'hmm', { callModel });
    expect(first.assistantMessages).toEqual([SCRIPT_QUESTIONS.q2_weight.canonical]);
    expect(first.state.phase).toBe('q2_weight');
    expect(first.state.reasksUsed.q2_weight).toBe(1);

    const second = await runCheckInTurn(first.state, 'still hmm', { callModel });
    expect(second.state.phase).toBe('q3_breathing');
    expect(second.state.extraction.weightLbs).toBeNull();
  });

  it('degrades to the fallback and preserves state when the model is unavailable', async () => {
    const input = stateAt('q2_weight');
    const response = await runCheckInTurn(input, '182', { callModel: vi.fn(async () => null) });

    expect(response.fallback).toBe(true);
    expect(response.state).toEqual(input);
    expect(response.assistantMessages).toEqual([]);
  });

  it('degrades to the fallback once the hard turn cap is exceeded', async () => {
    const capped = { ...stateAt('q2_weight'), turnCount: MAX_TURNS };
    const callModel = vi.fn(async () => llmTurn({ weightLbs: 182 }));
    const response = await runCheckInTurn(capped, '182', { callModel });

    expect(response.fallback).toBe(true);
    expect(callModel).not.toHaveBeenCalled();
  });
});

describe('finalizeCheckIn — deterministic red flags own the disposition', () => {
  it("escalates Maria's synthetic weight-gain trend with the registered criteria texts", () => {
    const finished = finalizeCheckIn({
      patientId: 'demo-maria',
      phase: 'q8_devices',
      extraction: { ...emptyExtraction(), weightLbs: 179, dyspnea: 2, edema: 1 },
      reasksUsed: {},
      turnCount: 8,
    });

    const ids = finished.redFlags.map((flag) => flag.id);
    expect(ids).toContain(RED_FLAG_CRITERIA.weight_gain_3lb_2d.id);
    expect(ids).toContain(RED_FLAG_CRITERIA.weight_gain_5lb_7d.id);
    expect(finished.disposition).toBe('escalated');
    expect(finished.assistantMessages[0]).toContain(RED_FLAG_CRITERIA.weight_gain_5lb_7d.message);
    expect(finished.assistantMessages[0]).toContain(RED_FLAG_CRITERIA.weight_gain_5lb_7d.action);
  });

  it('escalates symptomatic low blood pressure reported through the optional device question', () => {
    const finished = finalizeCheckIn({
      patientId: 'demo-james',
      phase: 'q8_devices',
      extraction: { ...emptyExtraction(), weightLbs: 188, sbp: 85, dyspnea: 1 },
      reasksUsed: {},
      turnCount: 8,
    });

    expect(finished.redFlags.map((flag) => flag.id)).toContain(RED_FLAG_CRITERIA.sbp_low_symptomatic.id);
    expect(finished.disposition).toBe('escalated');
  });

  it('escalates severe dyspnea at rest', () => {
    const finished = finalizeCheckIn({
      patientId: 'demo-james',
      phase: 'q8_devices',
      extraction: { ...emptyExtraction(), weightLbs: 188, dyspnea: 3 },
      reasksUsed: {},
      turnCount: 8,
    });

    expect(finished.redFlags.map((flag) => flag.id)).toContain(RED_FLAG_CRITERIA.dyspnea_rest.id);
  });

  it('stays routine for a stable report and summarizes the recorded values', () => {
    const finished = finalizeCheckIn({
      patientId: 'demo-james',
      phase: 'q8_devices',
      extraction: { ...emptyExtraction(), weightLbs: 188, dyspnea: 0, edema: 0, orthopnea: false, fatigue: 0, adherence: 'yes' },
      reasksUsed: {},
      turnCount: 8,
    });

    expect(finished.redFlags).toEqual([]);
    expect(finished.disposition).toBe('routine');
    expect(finished.assistantMessages[0]).toContain('weight 188 lbs');
    expect(finished.assistantMessages[0]).toContain('blood pressure: skipped');
  });
});
