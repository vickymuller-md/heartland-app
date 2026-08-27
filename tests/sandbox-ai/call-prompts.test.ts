import { describe, expect, it } from 'vitest';
import { CALL_PROMPTS, QUICK_ANSWERS, clipIdForText } from '@/lib/sandbox-ai/call-prompts';
import { DEFLECT_MESSAGE, EMERGENCY_911_MESSAGE, QUESTION_ORDER, SCRIPT_QUESTIONS } from '@/lib/sandbox-ai/script';

describe('CALL_PROMPTS', () => {
  it('covers the intro, every script question, and all four fixed closings', () => {
    const expected = ['intro', ...QUESTION_ORDER, 'escalated', 'routine', 'emergency', 'deflect'];
    expect(Object.keys(CALL_PROMPTS).sort()).toEqual([...expected].sort());
    for (const prompt of Object.values(CALL_PROMPTS)) {
      expect(prompt.audioSrc).toBe(`/outreach-audio/prompts/${prompt.id}.mp3`);
      expect(prompt.text.length).toBeGreaterThan(10);
    }
  });

  it('speaks the questions with their exact canonical wording', () => {
    for (const id of QUESTION_ORDER) {
      expect(CALL_PROMPTS[id].text).toBe(SCRIPT_QUESTIONS[id].canonical);
    }
  });
});

describe('clipIdForText', () => {
  it('resolves every canonical question and the chat-template equivalents', () => {
    for (const id of QUESTION_ORDER) {
      expect(clipIdForText(SCRIPT_QUESTIONS[id].canonical)).toBe(id);
    }
    expect(clipIdForText(DEFLECT_MESSAGE)).toBe('deflect');
    expect(clipIdForText(EMERGENCY_911_MESSAGE)).toBe('emergency');
  });

  it('returns null for dynamic lines', () => {
    expect(clipIdForText('What a treat to have your grandson visit.')).toBeNull();
  });
});

describe('QUICK_ANSWERS', () => {
  it('offers deterministic chips for every non-numeric question', () => {
    expect(Object.keys(QUICK_ANSWERS).sort()).toEqual(
      ['q1_safety', 'q3_breathing', 'q4_swelling', 'q5_orthopnea', 'q6_fatigue', 'q7_adherence'].sort(),
    );
  });

  it('maps chips onto valid extraction values only', () => {
    for (const answers of Object.values(QUICK_ANSWERS)) {
      for (const answer of answers!) {
        for (const [key, value] of Object.entries(answer.values)) {
          if (key === 'dyspnea' || key === 'edema' || key === 'fatigue') {
            expect([0, 1, 2, 3]).toContain(value);
          } else if (key === 'orthopnea' || key === 'chestPainOrSyncope') {
            expect(typeof value).toBe('boolean');
          } else if (key === 'adherence') {
            expect(['yes', 'missed_some', 'no']).toContain(value);
          } else {
            throw new Error(`Unexpected chip field: ${key}`);
          }
        }
      }
    }
  });
});
