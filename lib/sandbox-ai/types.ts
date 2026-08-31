/**
 * Sandbox AI-Assisted Check-In -- Type Contracts
 *
 * Public demonstration sandbox only (synthetic data). The LLM structures the
 * conversation; escalation is decided exclusively by the deterministic rules
 * in lib/vitals/red-flags.ts (see lib/clinical-governance/rule-registry.ts,
 * rule set `ai-outreach-structuring`).
 */

import type { RedFlag, SymptomSeverity } from '@/lib/vitals/types';

export type ScriptId = 'daily_checkin' | 'titration_followup';
export type CallLocale = 'en' | 'es';

export type ScriptQuestionId =
  | 'q1_safety'
  | 'q2_weight'
  | 'q3_breathing'
  | 'q4_swelling'
  | 'q5_orthopnea'
  | 'q6_fatigue'
  | 'q7_adherence'
  | 'q8_devices'
  | 't1_safety'
  | 't2_dizziness'
  | 't3_sbp'
  | 't4_hr'
  | 't5_symptoms'
  | 't6_adherence';

export type CheckInPhase = ScriptQuestionId | 'complete';

/**
 * Union of the fields every registered call script can extract. Each script
 * declares which keys it uses (ScriptQuestion.extractionKeys); the rest stay
 * null for that conversation. sbp, adherence, and chestPainOrSyncope are
 * shared between the daily check-in and the titration follow-up.
 */
export interface CheckInExtraction {
  weightLbs: number | null;
  sbp: number | null;
  spo2: number | null;
  dyspnea: SymptomSeverity | null;
  edema: SymptomSeverity | null;
  orthopnea: boolean | null;
  fatigue: SymptomSeverity | null;
  adherence: 'yes' | 'missed_some' | 'no' | null;
  chestPainOrSyncope: boolean | null;
  /** Titration follow-up: home heart rate reading. */
  hr: number | null;
  /** Titration follow-up: dizziness/lightheadedness severity since the dose change. */
  dizziness: SymptomSeverity | null;
  /** Titration follow-up: new or worse breathing trouble / fatigue since the dose change. */
  worseSymptoms: boolean | null;
}

export interface CheckInState {
  patientId: string;
  scriptId: ScriptId;
  locale: CallLocale;
  phase: CheckInPhase;
  extraction: CheckInExtraction;
  reasksUsed: Partial<Record<ScriptQuestionId, number>>;
  turnCount: number;
}

/** One registered conversational call script and its deterministic completion. */
export interface CallScript {
  id: ScriptId;
  questions: Partial<Record<ScriptQuestionId, ScriptQuestion>>;
  order: readonly ScriptQuestionId[];
  /** Deterministic completion; resolves the synthetic patient from state.patientId. */
  finalize(state: CheckInState): CheckInTurnResponse;
}

export type CheckInDisposition = 'emergency' | 'escalated' | 'routine';

/**
 * How one assistant message is voiced in the simulated live call: a
 * pre-generated static clip, or MP3 audio synthesized server-side for
 * dynamic lines. `null` slot = no audio available (text-only line).
 */
export type SpeechItem =
  | { kind: 'clip'; clipId: string }
  | { kind: 'audio'; mp3Base64: string };

export interface CheckInTurnResponse {
  assistantMessages: string[];
  /** Aligned by index with assistantMessages; present only when the client asked for speech. */
  speech?: Array<SpeechItem | null>;
  state: CheckInState;
  done: boolean;
  disposition: CheckInDisposition | null;
  redFlags: RedFlag[];
  fallback: boolean;
}

/** Validated output of one LLM structuring turn (see lib/sandbox-ai/schema.ts). */
export interface LlmTurn {
  say: {
    kind: 'question' | 'ack_question' | 'deflect_question' | 'small_talk';
    paraphrase: string;
    /** Warm 1-2 sentence reply to benign small talk; null for every other kind. */
    smallTalk: string | null;
  };
  /** Partial: the forced tool schema only exposes the active script's fields. */
  extracted: Partial<CheckInExtraction> & { unclear: boolean };
}

export interface ScriptQuestion {
  id: ScriptQuestionId;
  /** Canonical plain-language wording; also the fallback when a paraphrase is rejected. */
  canonical: string;
  /** Spanish canonical wording (clinical translation, reviewed before release). */
  canonicalEs: string;
  /** Extraction fields this question is expected to fill. */
  extractionKeys: ReadonlyArray<keyof CheckInExtraction>;
  /** Skippable questions (q8) may complete with all target fields null. */
  skippable: boolean;
}

/** Canonical wording of a question in the conversation's locale. */
export function canonicalFor(question: ScriptQuestion, locale: CallLocale): string {
  return locale === 'es' ? question.canonicalEs : question.canonical;
}
