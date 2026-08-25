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

export interface CheckInTurnResponse {
  assistantMessages: string[];
  state: CheckInState;
  done: boolean;
  disposition: CheckInDisposition | null;
  redFlags: RedFlag[];
  fallback: boolean;
}

/** Validated output of one LLM structuring turn (see lib/sandbox-ai/schema.ts). */
export interface LlmTurn {
  say: {
    kind: 'question' | 'ack_question' | 'deflect_question';
    paraphrase: string;
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
