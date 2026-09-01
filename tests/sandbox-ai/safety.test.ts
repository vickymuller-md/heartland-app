import { describe, expect, it } from 'vitest';
import {
  containsClinicalAdvice,
  containsObviousIdentifier,
  detectEmergencyMention,
} from '@/lib/sandbox-ai/safety';

describe('detectEmergencyMention', () => {
  it.each([
    'My chest hurts.',
    'There is pressure in my chest.',
    'There is crushing pain in the middle of my chest.',
    'My chest feels heavy.',
    'I nearly passed out this morning.',
    'I blacked out for a moment.',
    'I am not sure whether this is chest pain.',
    'I no longer have chest pain, but I did earlier.',
    'No swelling today. My chest hurts now.',
    "Chest pain? I'm not sure.",
    'Me duele el pecho.',
    'Siento opresión en el pecho.',
    'Me aprieta el pecho.',
    'Casi me desmayé al levantarme.',
    'Perdí el conocimiento por un momento.',
    'Sentí que me iba a desmayar.',
    'Ya no tengo dolor de pecho, pero lo tuve esta mañana.',
    'No tengo dolor de pecho, pero casi me desmayé.',
  ])('fails safe for affirmative or ambiguous wording: %s', (text) => {
    expect(detectEmergencyMention(text)).toBe(true);
  });

  it.each([
    'No chest pain or fainting.',
    'I have never fainted and have no chest pain.',
    'I am free of chest pain.',
    'No chest pain, and I did not faint.',
    'Sin dolor de pecho ni desmayos.',
    'No me duele el pecho y nunca me he desmayado.',
    'Dolor de pecho? No.',
    'My weight is 188 pounds and I feel fine.',
  ])('does not turn a clear negative into an emergency: %s', (text) => {
    expect(detectEmergencyMention(text)).toBe(false);
  });
});

describe('containsObviousIdentifier', () => {
  it.each([
    'visitor@example.com',
    'Call me at (555) 123-4567',
    'My phone is 555-123-4567',
    'Phone number: 5551234567',
    'Mi teléfono es 5551234567',
    'SSN: 123-45-6789',
    'Social Security number is 123456789',
  ])('detects an obvious direct identifier: %s', (text) => {
    expect(containsObviousIdentifier(text)).toBe(true);
  });

  it.each([
    'My weight is 188.5 pounds.',
    'Blood pressure is 120 over 80.',
    'Oxygen is 97%.',
    'I took 20 mg at 8:30.',
  ])('does not mistake ordinary clinical numbers for PII: %s', (text) => {
    expect(containsObviousIdentifier(text)).toBe(false);
  });
});

describe('containsClinicalAdvice', () => {
  it.each([
    'Stop taking furosemide tonight.',
    'You should rest and drink extra water.',
    'Call your doctor before continuing.',
    'Your swelling is normal and there is nothing to worry about.',
    'Debe descansar y beber más agua.',
    'Llame a su médico antes de continuar.',
  ])('blocks dose-free advice or reassurance: %s', (text) => {
    expect(containsClinicalAdvice(text)).toBe(true);
  });

  it.each([
    'What did the scale show this morning?',
    'Were you able to take all your medicines yesterday?',
    'That garden of yours sounds wonderful.',
    'How wonderful! What did you cook together?',
  ])('allows clean scripted or social language: %s', (text) => {
    expect(containsClinicalAdvice(text)).toBe(false);
  });
});
