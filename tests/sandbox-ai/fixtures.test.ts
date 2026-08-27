import { describe, expect, it } from 'vitest';
import {
  OUTREACH_TRANSCRIPTS,
  SIMULATED_CALL_SCENARIOS,
  outreachWorkItems,
  scenarioWeightHistory,
} from '@/lib/sandbox-ai/fixtures';
import { emptyExtraction, syntheticWeightHistory } from '@/lib/sandbox-ai/engine';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import { RED_FLAG_CRITERIA } from '@/lib/vitals/constants';
import { evaluateRedFlags } from '@/lib/vitals/red-flags';

describe('simulated outreach transcripts', () => {
  it('ships the four scripted calls with unique ids and non-empty transcripts', () => {
    expect(OUTREACH_TRANSCRIPTS).toHaveLength(4);
    expect(new Set(OUTREACH_TRANSCRIPTS.map((transcript) => transcript.id)).size).toBe(4);
    for (const transcript of OUTREACH_TRANSCRIPTS) {
      expect(transcript.turns.length).toBeGreaterThanOrEqual(2);
      expect(transcript.channel).toBe('automated-voice-simulation');
      expect(transcript.audioSrc).toBe(`/outreach-audio/${transcript.id}.mp3`);
    }
  });

  it('keeps every disposition consistent with the deterministic rule engine', () => {
    for (const transcript of OUTREACH_TRANSCRIPTS) {
      if (transcript.disposition === 'no_answer') continue;
      const patient = SANDBOX_PATIENTS.find((entry) => entry.id === transcript.patientId)!;
      const lastSynthetic = patient.vitals.at(-1)!;
      const recomputed = evaluateRedFlags(
        {
          weight_lbs: transcript.extraction.weightLbs ?? lastSynthetic.weight,
          sbp: transcript.extraction.sbp ?? lastSynthetic.sbp,
          spo2: transcript.extraction.spo2,
        },
        syntheticWeightHistory(patient),
        {
          dyspnea: transcript.extraction.dyspnea ?? 0,
          edema: transcript.extraction.edema ?? 0,
          orthopnea: transcript.extraction.orthopnea ?? false,
          fatigue: transcript.extraction.fatigue ?? 0,
        },
      );
      expect(transcript.redFlags.map((flag) => flag.id).sort()).toEqual(recomputed.map((flag) => flag.id).sort());
      expect(transcript.disposition).toBe(recomputed.length > 0 ? 'escalated' : 'routine');
    }
  });

  it('escalates the Maria call on both weight-trend rules and keeps the stable calls routine', () => {
    const maria = OUTREACH_TRANSCRIPTS.find((transcript) => transcript.id === 'call-maria-redflag')!;
    expect(maria.disposition).toBe('escalated');
    expect(maria.redFlags.map((flag) => flag.id)).toEqual(
      expect.arrayContaining([RED_FLAG_CRITERIA.weight_gain_3lb_2d.id, RED_FLAG_CRITERIA.weight_gain_5lb_7d.id]),
    );
    expect(OUTREACH_TRANSCRIPTS.find((transcript) => transcript.id === 'call-james-stable')!.disposition).toBe('routine');
    expect(OUTREACH_TRANSCRIPTS.find((transcript) => transcript.id === 'call-james-adherence')!.disposition).toBe('routine');
  });

  it('models the no-answer call as silence that escalates to a human, never as data', () => {
    const noAnswer = OUTREACH_TRANSCRIPTS.find((transcript) => transcript.id === 'call-robert-noanswer')!;
    expect(noAnswer.disposition).toBe('no_answer');
    expect(noAnswer.redFlags).toEqual([]);
    expect(noAnswer.extraction).toEqual(emptyExtraction());
    expect(noAnswer.note).toContain('human outreach');
  });
});

describe('outreachWorkItems', () => {
  it('lists live runs before fixtures and resolves red-flag ids to registered messages', () => {
    const items = outreachWorkItems([{
      id: 'ai-run-abc123',
      patientName: 'Earl Hutchins (synthetic)',
      disposition: 'escalated',
      redFlagIds: [RED_FLAG_CRITERIA.weight_gain_3lb_2d.id],
      atLabel: 'This visit',
    }]);
    expect(items[0].id).toBe('ai-run-abc123');
    expect(items[0].redFlagMessages).toEqual([RED_FLAG_CRITERIA.weight_gain_3lb_2d.message]);
    expect(items).toHaveLength(1 + OUTREACH_TRANSCRIPTS.length);
  });
});

describe('simulated-call scenarios', () => {
  it('provides three personas with recent-first weight history', () => {
    expect(SIMULATED_CALL_SCENARIOS).toHaveLength(3);
    for (const scenario of SIMULATED_CALL_SCENARIOS) {
      const history = scenarioWeightHistory(scenario);
      expect(history.length).toBeGreaterThanOrEqual(3);
      const times = history.map((entry) => new Date(entry.recorded_at).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    }
  });

  it('lets the weight-gain persona trip the two-day rule deterministically', () => {
    const scenario = SIMULATED_CALL_SCENARIOS.find((entry) => entry.id === 'scenario-weight-gain')!;
    const flags = evaluateRedFlags(
      { weight_lbs: 214, sbp: scenario.baselineSbp, spo2: null },
      scenarioWeightHistory(scenario),
      { dyspnea: 1, edema: 1, orthopnea: false, fatigue: 1 },
    );
    expect(flags.map((flag) => flag.id)).toContain(RED_FLAG_CRITERIA.weight_gain_3lb_2d.id);
  });
});
