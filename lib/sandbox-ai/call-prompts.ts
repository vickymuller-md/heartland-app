/**
 * Simulated Live Call -- Spoken Prompts & Deterministic Quick Answers
 *
 * Single source for (a) the fixed spoken lines whose audio is pre-generated
 * by scripts/generate-outreach-audio.mts (assistant voice; no runtime TTS),
 * and (b) the deterministic quick-answer chips that map straight onto
 * CheckInExtraction — the chips are also the complete offline fallback.
 */

import {
  DEFLECT_MESSAGE,
  EMERGENCY_911_MESSAGE,
  QUESTION_ORDER,
  SCRIPT_QUESTIONS,
  SPOKEN_CALL_INTRO,
  SPOKEN_DEFLECT,
  SPOKEN_EMERGENCY,
  SPOKEN_ESCALATION,
  SPOKEN_ROUTINE,
} from './script';
import type { CheckInExtraction, ScriptQuestionId } from './types';

export interface CallPrompt {
  id: string;
  text: string;
  audioSrc: string;
}

function prompt(id: string, text: string): CallPrompt {
  return { id, text, audioSrc: `/outreach-audio/prompts/${id}.mp3` };
}

/** Every fixed spoken line of the simulated call, keyed by clip id. */
export const CALL_PROMPTS: Record<string, CallPrompt> = {
  intro: prompt('intro', SPOKEN_CALL_INTRO),
  ...Object.fromEntries(
    QUESTION_ORDER.map((id) => [id, prompt(id, SCRIPT_QUESTIONS[id].canonical)]),
  ),
  escalated: prompt('escalated', SPOKEN_ESCALATION),
  routine: prompt('routine', SPOKEN_ROUTINE),
  emergency: prompt('emergency', SPOKEN_EMERGENCY),
  deflect: prompt('deflect', SPOKEN_DEFLECT),
};

const TEXT_TO_CLIP_ID = new Map([
  ...Object.values(CALL_PROMPTS).map((clip) => [clip.text, clip.id] as const),
  // Chat-template lines whose spoken variant differs slightly in wording:
  // the live call plays the clip and displays the clip's text (audio 1:1).
  [DEFLECT_MESSAGE, 'deflect'] as const,
  [EMERGENCY_911_MESSAGE, 'emergency'] as const,
]);

/** Clip id whose pre-generated audio covers this engine message, if any. */
export function clipIdForText(text: string): string | null {
  return TEXT_TO_CLIP_ID.get(text) ?? null;
}

export interface QuickAnswer {
  label: string;
  /** Fields this answer sets; merged into the call's CheckInExtraction. */
  values: Partial<CheckInExtraction>;
}

/**
 * Deterministic quick answers per question. Numeric questions (q2 weight,
 * q8 devices) use small inputs in the UI instead of chips.
 */
export const QUICK_ANSWERS: Partial<Record<ScriptQuestionId, QuickAnswer[]>> = {
  q1_safety: [
    { label: 'No, nothing like that', values: { chestPainOrSyncope: false } },
    { label: 'Yes — chest pain or fainting', values: { chestPainOrSyncope: true } },
  ],
  q3_breathing: [
    { label: 'Breathing fine', values: { dyspnea: 0 } },
    { label: 'Short of breath with heavy activity', values: { dyspnea: 1 } },
    { label: 'Short of breath with activity', values: { dyspnea: 2 } },
    { label: 'Short of breath even at rest', values: { dyspnea: 3 } },
  ],
  q4_swelling: [
    { label: 'No new swelling', values: { edema: 0 } },
    { label: 'Mild', values: { edema: 1 } },
    { label: 'Moderate', values: { edema: 2 } },
    { label: 'Severe', values: { edema: 3 } },
  ],
  q5_orthopnea: [
    { label: 'No, slept normally', values: { orthopnea: false } },
    { label: 'Yes — extra pillows or sitting up', values: { orthopnea: true } },
  ],
  q6_fatigue: [
    { label: 'Normal energy', values: { fatigue: 0 } },
    { label: 'A little low', values: { fatigue: 1 } },
    { label: 'Quite low', values: { fatigue: 2 } },
    { label: 'Exhausted', values: { fatigue: 3 } },
  ],
  q7_adherence: [
    { label: 'Yes, all taken', values: { adherence: 'yes' } },
    { label: 'Missed some', values: { adherence: 'missed_some' } },
    { label: 'No', values: { adherence: 'no' } },
  ],
};
