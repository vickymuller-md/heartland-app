import { describe, expect, it } from 'vitest';
import {
  applyDeterministicAnswer,
  createInitialState,
  emptyExtraction,
  finalizeCheckIn,
} from '@/lib/sandbox-ai/engine';
import { OUTREACH_TRANSCRIPTS } from '@/lib/sandbox-ai/fixtures';
import {
  SPOKEN_CALL_INTRO, SPOKEN_CALL_INTRO_ES,
  SPOKEN_DEFLECT, SPOKEN_DEFLECT_ES,
  SPOKEN_EMERGENCY, SPOKEN_EMERGENCY_ES,
  SPOKEN_ESCALATION, SPOKEN_ESCALATION_ES,
  SPOKEN_ROUTINE, SPOKEN_ROUTINE_ES,
  deflectMessageFor,
  emergencyMessageFor,
  escalationMessage,
  introMessagesFor,
} from '@/lib/sandbox-ai/script';
import {
  SPOKEN_TITRATION_INTRO, SPOKEN_TITRATION_INTRO_ES,
  SPOKEN_TITRATION_ESCALATION, SPOKEN_TITRATION_ESCALATION_ES,
  SPOKEN_TITRATION_ROUTINE, SPOKEN_TITRATION_ROUTINE_ES,
  finalizeTitration,
} from '@/lib/sandbox-ai/titration-script';
import type { CallLocale, CheckInExtraction } from '@/lib/sandbox-ai/types';
import { RED_FLAG_CRITERIA } from '@/lib/vitals/constants';

const LOCALES = ['en', 'es'] as const;
const DELIVERY_PROMISE = /(?:will|going to) call you|call you back|callback today|being notified|alerts? your care team right now|will (?:see|confirm)|same time tomorrow|check in tomorrow|talk soon|will get you a bottle|outreach scheduled|voicemail left|le (?:llamar[aá]|devolver[aá] la llamada)|est[aá] siendo notificado|alerta a su equipo|avisa a su equipo|confirmar[aá] el siguiente|equipo (?:de atenci[oó]n )?ver[aá]|misma hora ma[nñ]ana|hablamos pronto/i;

function expectSyntheticBoundary(text: string, locale: CallLocale) {
  expect(text).toMatch(locale === 'es' ? /sint[eé]tic[oa]/i : /synthetic/i);
  expect(text).toMatch(locale === 'es' ? /ninguna llamada|sin llamadas/i : /no real call/i);
  expect(text).toMatch(locale === 'es' ? /notificaci[oó]n/i : /notification/i);
  expect(text).toMatch(locale === 'es' ? /cita/i : /appointment/i);
  expect(text).not.toMatch(DELIVERY_PROMISE);
}

function expectHumanReview(text: string, locale: CallLocale) {
  expect(text).toMatch(locale === 'es' ? /revisi[oó]n humana/i : /human review/i);
}

function titrationResult(locale: CallLocale, extra: Partial<CheckInExtraction> = {}) {
  return finalizeTitration({
    ...createInitialState('demo-james', 'titration_followup', locale),
    extraction: {
      ...emptyExtraction(), chestPainOrSyncope: false, dizziness: 0,
      sbp: 121, hr: 71, worseSymptoms: false, adherence: 'yes', ...extra,
    },
  });
}

describe('synthetic demo — truthful deterministic messages', () => {
  it.each(LOCALES)('keeps all fixed spoken disclosures in %s out of audio-tag brackets', (locale) => {
    const spoken = locale === 'es'
      ? [SPOKEN_CALL_INTRO_ES, SPOKEN_DEFLECT_ES, SPOKEN_EMERGENCY_ES, SPOKEN_ESCALATION_ES, SPOKEN_ROUTINE_ES,
        SPOKEN_TITRATION_INTRO_ES, SPOKEN_TITRATION_ESCALATION_ES, SPOKEN_TITRATION_ROUTINE_ES]
      : [SPOKEN_CALL_INTRO, SPOKEN_DEFLECT, SPOKEN_EMERGENCY, SPOKEN_ESCALATION, SPOKEN_ROUTINE,
        SPOKEN_TITRATION_INTRO, SPOKEN_TITRATION_ESCALATION, SPOKEN_TITRATION_ROUTINE];
    for (const message of spoken) {
      expect(message).not.toContain('[');
      expect(message).not.toContain(']');
    }
  });

  it.each(LOCALES)('labels daily and titration chat closings in %s without promising contact', (locale) => {
    const stable = OUTREACH_TRANSCRIPTS.find((call) => call.id === 'call-james-stable')!;
    const flagged = OUTREACH_TRANSCRIPTS.find((call) => call.id === 'call-maria-redflag')!;
    const routine = finalizeCheckIn({
      ...createInitialState('demo-james', 'daily_checkin', locale), extraction: stable.extraction,
    });
    const escalated = finalizeCheckIn({
      ...createInitialState('demo-maria', 'daily_checkin', locale), extraction: flagged.extraction,
    });
    expect(routine.disposition).toBe('routine');
    expect(escalated.disposition).toBe('escalated');
    for (const result of [routine, escalated, titrationResult(locale), titrationResult(locale, { sbp: 94 })]) {
      expect(result.done).toBe(true);
      for (const message of result.assistantMessages) {
        expectSyntheticBoundary(message, locale);
        expectHumanReview(message, locale);
      }
    }
    expect(titrationResult(locale).redFlags).toEqual([]);
    expect(titrationResult(locale, { sbp: 94 }).redFlags.map((flag) => flag.id)).toContain('titration_gate_hold');
  });

  it.each(LOCALES)('labels every daily and titration spoken closing in %s', (locale) => {
    const messages = locale === 'es'
      ? [SPOKEN_ROUTINE_ES, SPOKEN_ESCALATION_ES, SPOKEN_TITRATION_ROUTINE_ES, SPOKEN_TITRATION_ESCALATION_ES]
      : [SPOKEN_ROUTINE, SPOKEN_ESCALATION, SPOKEN_TITRATION_ROUTINE, SPOKEN_TITRATION_ESCALATION];
    for (const message of messages) {
      expectSyntheticBoundary(message, locale);
      expectHumanReview(message, locale);
      expect(message).toContain('911');
    }
  });

  it.each(LOCALES)('keeps chat and spoken emergency guidance immediate and independent of the demo in %s', (locale) => {
    for (const scriptId of ['daily_checkin', 'titration_followup'] as const) {
      const result = applyDeterministicAnswer(createInitialState('demo-james', scriptId, locale), { chestPainOrSyncope: true });
      expect(result.disposition).toBe('emergency');
      expect(result.assistantMessages).toEqual([emergencyMessageFor(locale)]);
    }
    for (const message of [emergencyMessageFor(locale), locale === 'es' ? SPOKEN_EMERGENCY_ES : SPOKEN_EMERGENCY]) {
      expectSyntheticBoundary(message, locale);
      expect(message).toMatch(locale === 'es' ? /llame al 911.*de inmediato/i : /call 911.*immediately/i);
      expect(message).toMatch(locale === 'es' ? /no espere/i : /do not wait/i);
      expect(message).not.toMatch(/in a real deployment|en un despliegue real/i);
    }
  });

  it.each(LOCALES)('introduces collection-only assistance and deflects medical decisions in %s', (locale) => {
    const intros = [introMessagesFor(locale)[0], ...(locale === 'es'
      ? [SPOKEN_CALL_INTRO_ES, SPOKEN_TITRATION_INTRO_ES]
      : [SPOKEN_CALL_INTRO, SPOKEN_TITRATION_INTRO])];
    for (const message of intros) {
      expectSyntheticBoundary(message, locale);
      expectHumanReview(message, locale);
      expect(message).toMatch(locale === 'es' ? /nunca tomo decisiones m[eé]dicas/i : /never make medical decisions/i);
    }
    for (const message of [deflectMessageFor(locale), locale === 'es' ? SPOKEN_DEFLECT_ES : SPOKEN_DEFLECT]) {
      expectSyntheticBoundary(message, locale);
      expect(message).toMatch(locale === 'es' ? /no puedo dar consejos m[eé]dicos/i : /can't give medical advice/i);
      expect(message).toContain('911');
    }
  });

  it.each(LOCALES)('preserves registered daily actions verbatim as rule guidance, not dispatched services, in %s', (locale) => {
    const rules = Object.values(RED_FLAG_CRITERIA);
    const message = escalationMessage(rules, locale);
    expectSyntheticBoundary(message, locale);
    for (const rule of rules) {
      expect(message).toContain(`${rule.message} — ${rule.action}.`);
    }
  });

  it.each(LOCALES)('keeps titration safety actions and removes the callback promise from action data in %s', (locale) => {
    const result = titrationResult(locale, { sbp: 95, dizziness: 2, worseSymptoms: true, adherence: 'missed_some' });
    expect(result.disposition).toBe('escalated');
    expect(result.redFlags).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'titration_gate_hold', action: 'Nurse review before any dose change' }),
      expect.objectContaining({ id: 'titration_symptomatic_hypotension', action: 'Hold the new dose; nurse review required' }),
      expect.objectContaining({ id: 'titration_worse_symptoms', action: 'Nurse review before any dose change' }),
      expect.objectContaining({ id: 'titration_adherence', action: 'Nurse review of barriers before any dose change' }),
    ]));
    for (const flag of result.redFlags) {
      expect(flag.action).not.toMatch(DELIVERY_PROMISE);
      expect(result.assistantMessages[0]).toContain(`${flag.message} — ${flag.action}.`);
    }
    expectSyntheticBoundary(result.assistantMessages[0], locale);
  });
});

describe('synthetic demo — four prerecorded fixture scripts', () => {
  it.each(OUTREACH_TRANSCRIPTS.map((call) => [call.id, call] as const))('labels %s without promising or claiming real follow-up', (_id, call) => {
    expectSyntheticBoundary(call.turns[0].text, 'en');
    expectSyntheticBoundary(call.note ?? '', 'en');
    const text = [...call.turns.map((turn) => turn.text), call.note ?? ''].join(' ');
    expect(text).not.toMatch(DELIVERY_PROMISE);
    expect(text).toMatch(/human review|simulated human/i);
    expect(call.audioSrc).toBe(`/outreach-audio/${call.id}.mp3`);
  });

  it('presents the easy-open cap resolution as simulated human follow-up only', () => {
    const stable = OUTREACH_TRANSCRIPTS.find((call) => call.id === 'call-james-stable')!;
    expect(stable.note).toMatch(/simulated human/i);
    expect(stable.note).toMatch(/easy-open/i);
    expect(stable.note).toMatch(/no real.*deliver/i);
    const barrier = OUTREACH_TRANSCRIPTS.find((call) => call.id === 'call-james-adherence')!;
    expect(barrier.note).toMatch(/review required/i);
  });

  it('never equates unanswered synthetic calls with safety, a delivered voicemail, or scheduled outreach', () => {
    const call = OUTREACH_TRANSCRIPTS.find((entry) => entry.id === 'call-robert-noanswer')!;
    expect(call.disposition).toBe('no_answer');
    expect(call.extraction).toEqual(emptyExtraction());
    expect(call.note).toMatch(/human outreach.*review required/i);
    expect(call.turns.map((turn) => turn.text).join(' ')).not.toMatch(/no emergency|voicemail left/i);
  });
});
