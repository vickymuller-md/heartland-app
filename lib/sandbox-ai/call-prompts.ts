/**
 * Simulated Live Call -- Spoken Prompts & Deterministic Quick Answers
 *
 * Single source for (a) the fixed spoken lines whose audio is pre-generated
 * by scripts/generate-outreach-audio.mts (assistant voice; per script and
 * locale; no runtime TTS for these), and (b) the deterministic quick-answer
 * chips that map straight onto CheckInExtraction — the chips are also the
 * complete offline fallback for every script.
 */

import {
  DEFLECT_MESSAGE,
  DEFLECT_MESSAGE_ES,
  EMERGENCY_911_MESSAGE,
  EMERGENCY_911_MESSAGE_ES,
  FILLER_LINES,
  SCRIPT_QUESTIONS,
  QUESTION_ORDER,
  SPOKEN_CALL_INTRO,
  SPOKEN_CALL_INTRO_ES,
  SPOKEN_DEFLECT,
  SPOKEN_DEFLECT_ES,
  SPOKEN_EMERGENCY,
  SPOKEN_EMERGENCY_ES,
  SPOKEN_ESCALATION,
  SPOKEN_ESCALATION_ES,
  SPOKEN_ROUTINE,
  SPOKEN_ROUTINE_ES,
} from './script';
import {
  SPOKEN_TITRATION_ESCALATION,
  SPOKEN_TITRATION_ESCALATION_ES,
  SPOKEN_TITRATION_INTRO,
  SPOKEN_TITRATION_INTRO_ES,
  SPOKEN_TITRATION_ROUTINE,
  SPOKEN_TITRATION_ROUTINE_ES,
  TITRATION_ORDER,
  TITRATION_QUESTIONS,
} from './titration-script';
import { canonicalFor } from './types';
import type { CallLocale, CheckInExtraction, ScriptId, ScriptQuestionId } from './types';

export interface CallPrompt {
  id: string;
  text: string;
  audioSrc: string;
}

function promptAt(scriptId: ScriptId, locale: CallLocale, id: string, text: string): CallPrompt {
  return { id, text, audioSrc: `/outreach-audio/prompts/${scriptId}/${locale}/${id}.mp3` };
}

const SPOKEN_CLOSINGS: Record<ScriptId, Record<CallLocale, Record<string, string>>> = {
  daily_checkin: {
    en: { intro: SPOKEN_CALL_INTRO, escalated: SPOKEN_ESCALATION, routine: SPOKEN_ROUTINE, emergency: SPOKEN_EMERGENCY, deflect: SPOKEN_DEFLECT },
    es: { intro: SPOKEN_CALL_INTRO_ES, escalated: SPOKEN_ESCALATION_ES, routine: SPOKEN_ROUTINE_ES, emergency: SPOKEN_EMERGENCY_ES, deflect: SPOKEN_DEFLECT_ES },
  },
  titration_followup: {
    en: { intro: SPOKEN_TITRATION_INTRO, escalated: SPOKEN_TITRATION_ESCALATION, routine: SPOKEN_TITRATION_ROUTINE, emergency: SPOKEN_EMERGENCY, deflect: SPOKEN_DEFLECT },
    es: { intro: SPOKEN_TITRATION_INTRO_ES, escalated: SPOKEN_TITRATION_ESCALATION_ES, routine: SPOKEN_TITRATION_ROUTINE_ES, emergency: SPOKEN_EMERGENCY_ES, deflect: SPOKEN_DEFLECT_ES },
  },
};

const SCRIPT_QUESTION_SETS: Record<ScriptId, { questions: typeof SCRIPT_QUESTIONS; order: readonly ScriptQuestionId[] }> = {
  daily_checkin: { questions: SCRIPT_QUESTIONS, order: QUESTION_ORDER },
  titration_followup: { questions: TITRATION_QUESTIONS, order: TITRATION_ORDER },
};

function buildPrompts(scriptId: ScriptId, locale: CallLocale): Record<string, CallPrompt> {
  const { questions, order } = SCRIPT_QUESTION_SETS[scriptId];
  return {
    ...Object.fromEntries(Object.entries(SPOKEN_CLOSINGS[scriptId][locale]).map(
      ([id, text]) => [id, promptAt(scriptId, locale, id, text)],
    )),
    ...Object.fromEntries(order.map((id) => {
      const question = questions[id];
      return [id, promptAt(scriptId, locale, id, question ? canonicalFor(question, locale) : '')];
    })),
  };
}

const PROMPTS: Record<ScriptId, Record<CallLocale, Record<string, CallPrompt>>> = {
  daily_checkin: { en: buildPrompts('daily_checkin', 'en'), es: buildPrompts('daily_checkin', 'es') },
  titration_followup: { en: buildPrompts('titration_followup', 'en'), es: buildPrompts('titration_followup', 'es') },
};

/** Every fixed spoken line of one simulated call, keyed by clip id. */
export function callPromptsFor(scriptId: ScriptId, locale: CallLocale): Record<string, CallPrompt> {
  return PROMPTS[scriptId][locale];
}

/** Legacy alias: the daily check-in call in English. */
export const CALL_PROMPTS: Record<string, CallPrompt> = PROMPTS.daily_checkin.en;

/** Short spoken acknowledgments played while a voice turn is processing. */
export function fillerPromptsFor(locale: CallLocale): CallPrompt[] {
  return FILLER_LINES[locale].map((text, index) => ({
    id: `filler_${index + 1}`,
    text,
    audioSrc: `/outreach-audio/prompts/fillers/${locale}/filler_${index + 1}.mp3`,
  }));
}

// Chat-template lines whose spoken variant differs slightly in wording: the
// live call plays the clip and displays the clip's text (audio 1:1).
const CHAT_TEMPLATE_CLIPS: Record<CallLocale, ReadonlyArray<readonly [string, string]>> = {
  en: [[DEFLECT_MESSAGE, 'deflect'], [EMERGENCY_911_MESSAGE, 'emergency']],
  es: [[DEFLECT_MESSAGE_ES, 'deflect'], [EMERGENCY_911_MESSAGE_ES, 'emergency']],
};

/** Clip id whose pre-generated audio covers this engine message, if any. */
export function clipIdForText(text: string, scriptId: ScriptId = 'daily_checkin', locale: CallLocale = 'en'): string | null {
  for (const prompt of Object.values(PROMPTS[scriptId][locale])) {
    if (prompt.text === text) return prompt.id;
  }
  for (const [template, clipId] of CHAT_TEMPLATE_CLIPS[locale]) {
    if (template === text) return clipId;
  }
  return null;
}

export interface QuickAnswer {
  label: string;
  labelEs: string;
  /** Fields this answer sets; merged into the call's CheckInExtraction. */
  values: Partial<CheckInExtraction>;
}

export function quickAnswerLabel(answer: QuickAnswer, locale: CallLocale): string {
  return locale === 'es' ? answer.labelEs : answer.label;
}

/**
 * Deterministic quick answers per question. Numeric questions (daily q2
 * weight, q8 devices; titration t3 blood pressure, t4 heart rate) use small
 * inputs in the UI instead of chips.
 */
export const QUICK_ANSWERS: Partial<Record<ScriptQuestionId, QuickAnswer[]>> = {
  q1_safety: [
    { label: 'No, nothing like that', labelEs: 'No, nada de eso', values: { chestPainOrSyncope: false } },
    { label: 'Yes — chest pain or fainting', labelEs: 'Sí — dolor de pecho o desmayo', values: { chestPainOrSyncope: true } },
  ],
  q3_breathing: [
    { label: 'Breathing fine', labelEs: 'Respirando bien', values: { dyspnea: 0 } },
    { label: 'Short of breath with heavy activity', labelEs: 'Falta de aire con actividad intensa', values: { dyspnea: 1 } },
    { label: 'Short of breath with activity', labelEs: 'Falta de aire con actividad', values: { dyspnea: 2 } },
    { label: 'Short of breath even at rest', labelEs: 'Falta de aire incluso en reposo', values: { dyspnea: 3 } },
  ],
  q4_swelling: [
    { label: 'No new swelling', labelEs: 'Sin hinchazón nueva', values: { edema: 0 } },
    { label: 'Mild', labelEs: 'Leve', values: { edema: 1 } },
    { label: 'Moderate', labelEs: 'Moderada', values: { edema: 2 } },
    { label: 'Severe', labelEs: 'Grave', values: { edema: 3 } },
  ],
  q5_orthopnea: [
    { label: 'No, slept normally', labelEs: 'No, dormí normal', values: { orthopnea: false } },
    { label: 'Yes — extra pillows or sitting up', labelEs: 'Sí — almohadas adicionales o sentado', values: { orthopnea: true } },
  ],
  q6_fatigue: [
    { label: 'Normal energy', labelEs: 'Energía normal', values: { fatigue: 0 } },
    { label: 'A little low', labelEs: 'Un poco baja', values: { fatigue: 1 } },
    { label: 'Quite low', labelEs: 'Bastante baja', values: { fatigue: 2 } },
    { label: 'Exhausted', labelEs: 'Agotado', values: { fatigue: 3 } },
  ],
  q7_adherence: [
    { label: 'Yes, all taken', labelEs: 'Sí, todas tomadas', values: { adherence: 'yes' } },
    { label: 'Missed some', labelEs: 'Faltaron algunas', values: { adherence: 'missed_some' } },
    { label: 'No', labelEs: 'No', values: { adherence: 'no' } },
  ],
  t1_safety: [
    { label: 'No, nothing like that', labelEs: 'No, nada de eso', values: { chestPainOrSyncope: false } },
    { label: 'Yes — chest pain or fainting', labelEs: 'Sí — dolor de pecho o desmayo', values: { chestPainOrSyncope: true } },
  ],
  t2_dizziness: [
    { label: 'No dizziness', labelEs: 'Sin mareos', values: { dizziness: 0 } },
    { label: 'A little, briefly', labelEs: 'Un poco, brevemente', values: { dizziness: 1 } },
    { label: 'Yes, when standing up', labelEs: 'Sí, al ponerme de pie', values: { dizziness: 2 } },
    { label: 'Severe — almost fell', labelEs: 'Grave — casi me caigo', values: { dizziness: 3 } },
  ],
  t5_symptoms: [
    { label: 'No, feeling the same', labelEs: 'No, me siento igual', values: { worseSymptoms: false } },
    { label: 'Yes — worse than before', labelEs: 'Sí — peor que antes', values: { worseSymptoms: true } },
  ],
  t6_adherence: [
    { label: 'Yes, every day', labelEs: 'Sí, todos los días', values: { adherence: 'yes' } },
    { label: 'Missed some days', labelEs: 'Falté algunos días', values: { adherence: 'missed_some' } },
    { label: 'No', labelEs: 'No', values: { adherence: 'no' } },
  ],
};
