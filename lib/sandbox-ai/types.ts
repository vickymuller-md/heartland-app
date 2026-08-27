/**
 * Sandbox AI-Assisted Check-In -- Type Contracts
 *
 * Public demonstration sandbox only (synthetic data). The LLM structures the
 * conversation; escalation is decided exclusively by the deterministic rules
 * in lib/vitals/red-flags.ts (see lib/clinical-governance/rule-registry.ts,
 * rule set `ai-outreach-structuring`).
 */

import type { RedFlag, SymptomSeverity } from '@/lib/vitals/types';

export type ScriptQuestionId =
  | 'q1_safety'
  | 'q2_weight'
  | 'q3_breathing'
  | 'q4_swelling'
  | 'q5_orthopnea'
  | 'q6_fatigue'
  | 'q7_adherence'
  | 'q8_devices';

export type CheckInPhase = ScriptQuestionId | 'complete';

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
}

export interface CheckInState {
  patientId: string;
  phase: CheckInPhase;
  extraction: CheckInExtraction;
  reasksUsed: Partial<Record<ScriptQuestionId, number>>;
  turnCount: number;
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
  extracted: CheckInExtraction & { unclear: boolean };
}

export interface ScriptQuestion {
  id: ScriptQuestionId;
  /** Canonical plain-language wording; also the fallback when a paraphrase is rejected. */
  canonical: string;
  /** Extraction fields this question is expected to fill. */
  extractionKeys: ReadonlyArray<keyof CheckInExtraction>;
  /** Skippable questions (q8) may complete with all target fields null. */
  skippable: boolean;
}
