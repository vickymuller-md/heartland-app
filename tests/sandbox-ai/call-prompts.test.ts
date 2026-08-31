import { describe, expect, it } from 'vitest';
import { CALL_PROMPTS, QUICK_ANSWERS, callPromptsFor, clipIdForText, fillerPromptsFor, quickAnswerLabel } from '@/lib/sandbox-ai/call-prompts';
import { DEFLECT_MESSAGE, DEFLECT_MESSAGE_ES, EMERGENCY_911_MESSAGE, QUESTION_ORDER, SCRIPT_QUESTIONS } from '@/lib/sandbox-ai/script';
import { TITRATION_ORDER, TITRATION_QUESTIONS } from '@/lib/sandbox-ai/titration-script';

const CLOSING_IDS = ['intro', 'escalated', 'routine', 'emergency', 'deflect'];

describe('callPromptsFor', () => {
  it('covers the intro, every script question, and all four fixed closings per script and locale', () => {
    for (const [scriptId, order] of [['daily_checkin', QUESTION_ORDER], ['titration_followup', TITRATION_ORDER]] as const) {
      for (const locale of ['en', 'es'] as const) {
        const prompts = callPromptsFor(scriptId, locale);
        expect(Object.keys(prompts).sort()).toEqual([...CLOSING_IDS, ...order].sort());
        for (const prompt of Object.values(prompts)) {
          expect(prompt.audioSrc).toBe(`/outreach-audio/prompts/${scriptId}/${locale}/${prompt.id}.mp3`);
          expect(prompt.text.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it('speaks the questions with their exact canonical wording in each locale', () => {
    for (const id of QUESTION_ORDER) {
      expect(callPromptsFor('daily_checkin', 'en')[id].text).toBe(SCRIPT_QUESTIONS[id].canonical);
      expect(callPromptsFor('daily_checkin', 'es')[id].text).toBe(SCRIPT_QUESTIONS[id].canonicalEs);
    }
    for (const id of TITRATION_ORDER) {
      expect(callPromptsFor('titration_followup', 'en')[id].text).toBe(TITRATION_QUESTIONS[id].canonical);
      expect(callPromptsFor('titration_followup', 'es')[id].text).toBe(TITRATION_QUESTIONS[id].canonicalEs);
    }
  });

  it('keeps the legacy CALL_PROMPTS alias pointing at the English daily check-in', () => {
    expect(CALL_PROMPTS.q1_safety.audioSrc).toBe('/outreach-audio/prompts/daily_checkin/en/q1_safety.mp3');
  });

  it('provides three filler acknowledgments per locale', () => {
    for (const locale of ['en', 'es'] as const) {
      const fillers = fillerPromptsFor(locale);
      expect(fillers).toHaveLength(3);
      for (const filler of fillers) {
        expect(filler.audioSrc).toBe(`/outreach-audio/prompts/fillers/${locale}/${filler.id}.mp3`);
      }
    }
  });
});

describe('clipIdForText', () => {
  it('resolves every canonical question and the chat-template equivalents per locale', () => {
    for (const id of QUESTION_ORDER) {
      expect(clipIdForText(SCRIPT_QUESTIONS[id].canonical)).toBe(id);
      expect(clipIdForText(SCRIPT_QUESTIONS[id].canonicalEs, 'daily_checkin', 'es')).toBe(id);
    }
    expect(clipIdForText(DEFLECT_MESSAGE)).toBe('deflect');
    expect(clipIdForText(DEFLECT_MESSAGE_ES, 'daily_checkin', 'es')).toBe('deflect');
    expect(clipIdForText(EMERGENCY_911_MESSAGE)).toBe('emergency');
    expect(clipIdForText(TITRATION_QUESTIONS.t2_dizziness.canonical, 'titration_followup', 'en')).toBe('t2_dizziness');
  });

  it('returns null for dynamic lines', () => {
    expect(clipIdForText('What a treat to have your grandson visit.')).toBeNull();
  });
});

describe('QUICK_ANSWERS', () => {
  it('offers deterministic chips for every non-numeric question of both scripts', () => {
    expect(Object.keys(QUICK_ANSWERS).sort()).toEqual(
      ['q1_safety', 'q3_breathing', 'q4_swelling', 'q5_orthopnea', 'q6_fatigue', 'q7_adherence',
        't1_safety', 't2_dizziness', 't5_symptoms', 't6_adherence'].sort(),
    );
  });

  it('maps chips onto valid extraction values only, with both locale labels', () => {
    for (const answers of Object.values(QUICK_ANSWERS)) {
      for (const answer of answers!) {
        expect(answer.label.length).toBeGreaterThan(0);
        expect(answer.labelEs.length).toBeGreaterThan(0);
        expect(quickAnswerLabel(answer, 'es')).toBe(answer.labelEs);
        for (const [key, value] of Object.entries(answer.values)) {
          if (key === 'dyspnea' || key === 'edema' || key === 'fatigue' || key === 'dizziness') {
            expect([0, 1, 2, 3]).toContain(value);
          } else if (key === 'orthopnea' || key === 'chestPainOrSyncope' || key === 'worseSymptoms') {
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
