import { describe, expect, it } from 'vitest';
import {
  SMALL_TALK_FALLBACK_ACK,
  checkInRequestSchema,
  llmTurnSchema,
  parseLlmTurn,
  sanitizeParaphrase,
  sanitizeSmallTalk,
} from '@/lib/sandbox-ai/schema';
import { createInitialState } from '@/lib/sandbox-ai/engine';

const validTurn = {
  say: { kind: 'question', paraphrase: 'How is your breathing today?', smallTalk: null },
  extracted: {
    weightLbs: null, sbp: null, spo2: null, dyspnea: 2, edema: null,
    orthopnea: null, fatigue: null, adherence: null, chestPainOrSyncope: false,
    unclear: false,
  },
};

describe('llmTurnSchema', () => {
  it('accepts a well-formed turn', () => {
    expect(parseLlmTurn(validTurn)).not.toBeNull();
  });

  it('rejects unknown fields anywhere in the payload', () => {
    expect(parseLlmTurn({ ...validTurn, injected: 'x' })).toBeNull();
    expect(parseLlmTurn({ ...validTurn, say: { ...validTurn.say, tone: 'urgent' } })).toBeNull();
    expect(parseLlmTurn({ ...validTurn, extracted: { ...validTurn.extracted, freeText: 'hi' } })).toBeNull();
  });

  it('rejects out-of-range clinical values', () => {
    expect(parseLlmTurn({ ...validTurn, extracted: { ...validTurn.extracted, dyspnea: 4 } })).toBeNull();
    expect(parseLlmTurn({ ...validTurn, extracted: { ...validTurn.extracted, weightLbs: 30 } })).toBeNull();
    expect(parseLlmTurn({ ...validTurn, extracted: { ...validTurn.extracted, adherence: 'sometimes' } })).toBeNull();
  });

  it('rejects an over-length paraphrase', () => {
    const result = llmTurnSchema.safeParse({
      ...validTurn,
      say: { ...validTurn.say, paraphrase: 'x'.repeat(281) },
    });
    expect(result.success).toBe(false);
  });

  it('accepts the small_talk kind with a reply and rejects an over-length one', () => {
    expect(parseLlmTurn({
      ...validTurn,
      say: { kind: 'small_talk', paraphrase: 'How is your breathing today?', smallTalk: 'That sounds like a lovely visit.' },
    })).not.toBeNull();
    expect(parseLlmTurn({
      ...validTurn,
      say: { ...validTurn.say, kind: 'small_talk', smallTalk: 'x'.repeat(201) },
    })).toBeNull();
    expect(parseLlmTurn({
      ...validTurn,
      say: { kind: 'question', paraphrase: 'ok' },
    })).toBeNull(); // smallTalk is a required key
  });
});

describe('sanitizeSmallTalk', () => {
  it('keeps a warm, clean ack', () => {
    expect(sanitizeSmallTalk('  What a treat to have  your grandson visit. '))
      .toBe('What a treat to have your grandson visit.');
  });

  it.each([
    null,
    '',
    'x'.repeat(201),
    'How wonderful! What did you two do together?',
    'Lovely — remember your 40 mg dose tonight.',
    'So nice! See www.example.com for photos',
  ])('falls back to the fixed ack for %s', (bad) => {
    expect(sanitizeSmallTalk(bad as string | null)).toBe(SMALL_TALK_FALLBACK_ACK);
  });
});

describe('sanitizeParaphrase', () => {
  const canonical = 'What did the scale show this morning, in pounds?';

  it('keeps clean plain-language questions', () => {
    expect(sanitizeParaphrase('  And what did your   scale say today? ', canonical))
      .toBe('And what did your scale say today?');
  });

  it.each([
    'Check http://example.com for advice',
    'See www.example.com',
    'Click [here] for your results',
    'Run `rm -rf` now',
    '<b>Weight?</b>',
    'You should take 40 mg now, then tell me your weight',
    'Take one extra tablet and weigh yourself',
  ])('falls back to the canonical wording for %s', (malicious) => {
    expect(sanitizeParaphrase(malicious, canonical)).toBe(canonical);
  });
});

describe('checkInRequestSchema', () => {
  const valid = {
    state: createInitialState('demo-maria'),
    message: 'no chest pain',
  };

  it('accepts a valid request with or without a session id', () => {
    expect(checkInRequestSchema.safeParse(valid).success).toBe(true);
    expect(checkInRequestSchema.safeParse({
      ...valid,
      anonymousSessionId: '3b241101-e2bb-4255-8caf-4136c566a962',
    }).success).toBe(true);
  });

  it('accepts the wantSpeech flag as a boolean only', () => {
    expect(checkInRequestSchema.safeParse({ ...valid, wantSpeech: true }).success).toBe(true);
    expect(checkInRequestSchema.safeParse({ ...valid, wantSpeech: 'yes' }).success).toBe(false);
  });

  it('rejects oversized messages, bad phases, bad session ids, and extra keys', () => {
    expect(checkInRequestSchema.safeParse({ ...valid, message: 'x'.repeat(501) }).success).toBe(false);
    expect(checkInRequestSchema.safeParse({
      ...valid, state: { ...valid.state, phase: 'q99_hack' },
    }).success).toBe(false);
    expect(checkInRequestSchema.safeParse({
      ...valid, anonymousSessionId: 'not-a-uuid',
    }).success).toBe(false);
    expect(checkInRequestSchema.safeParse({ ...valid, admin: true }).success).toBe(false);
  });
});
