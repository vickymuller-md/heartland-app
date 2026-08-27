/**
 * Sandbox AI-Assisted Check-In -- Deterministic Controller
 *
 * Owns question order, re-asks, the chest-pain emergency short-circuit, and
 * final disposition. The LLM (deps.callModel) only paraphrases the next
 * question and extracts structured data; every escalation decision runs
 * through evaluateRedFlags (lib/vitals/red-flags.ts). Pure module: the
 * fallback form reuses finalizeCheckIn client-side with identical results.
 */

import { subDays } from 'date-fns';
import { evaluateRedFlags } from '@/lib/vitals/red-flags';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import type { SandboxPatient } from '@/lib/sandbox/types';
import {
  DEFLECT_MESSAGE,
  EMERGENCY_911_MESSAGE,
  SCRIPT_QUESTIONS,
  escalationMessage,
  nextQuestionId,
  routineClosingMessage,
} from './script';
import { sanitizeParaphrase, sanitizeSmallTalk } from './schema';
import type {
  CheckInExtraction,
  CheckInState,
  CheckInTurnResponse,
  LlmTurn,
  ScriptQuestion,
} from './types';

export const MAX_TURNS = 30;
const MAX_MESSAGE_LENGTH = 500;

const EXTRACTION_KEYS: ReadonlyArray<keyof CheckInExtraction> = [
  'weightLbs', 'sbp', 'spo2', 'dyspnea', 'edema', 'orthopnea',
  'fatigue', 'adherence', 'chestPainOrSyncope',
];

export interface EngineDeps {
  callModel: (input: {
    currentQuestion: ScriptQuestion;
    nextQuestion: ScriptQuestion | null;
    reasksUsed: number;
    visitorReply: string;
  }) => Promise<LlmTurn | null>;
}

export function emptyExtraction(): CheckInExtraction {
  return {
    weightLbs: null, sbp: null, spo2: null, dyspnea: null, edema: null,
    orthopnea: null, fatigue: null, adherence: null, chestPainOrSyncope: null,
  };
}

export function createInitialState(patientId: string): CheckInState {
  return { patientId, phase: 'q1_safety', extraction: emptyExtraction(), reasksUsed: {}, turnCount: 0 };
}

function mergeExtraction(base: CheckInExtraction, incoming: CheckInExtraction): CheckInExtraction {
  const merged = { ...base };
  for (const key of EXTRACTION_KEYS) {
    const value = incoming[key];
    if (value !== null) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

function fallbackResponse(state: CheckInState): CheckInTurnResponse {
  return { assistantMessages: [], state, done: false, disposition: null, redFlags: [], fallback: true };
}

/** Fixture labels ("5d ago" / "Yesterday" / "Today") -> days before now. */
function labelToDaysAgo(label: string): number | null {
  if (label === 'Today') return 0;
  if (label === 'Yesterday') return 1;
  const match = /^(\d+)d ago$/.exec(label);
  return match ? Number(match[1]) : null;
}

/**
 * Synthetic weight history for trend red flags, most recent first. The
 * fixture's "Today" entry is excluded: the check-in itself is today's reading.
 */
export function syntheticWeightHistory(patient: SandboxPatient): Array<{ weight_lbs: number; recorded_at: string }> {
  const now = new Date();
  return patient.vitals
    .map((point) => ({ point, daysAgo: labelToDaysAgo(point.label) }))
    .filter((entry): entry is { point: typeof entry.point; daysAgo: number } =>
      entry.daysAgo !== null && entry.daysAgo > 0)
    .sort((a, b) => a.daysAgo - b.daysAgo)
    .map(({ point, daysAgo }) => ({
      weight_lbs: point.weight,
      recorded_at: subDays(now, daysAgo).toISOString(),
    }));
}

/**
 * Deterministic completion: red flags + disposition + closing messages.
 * Shared by the chat path (server) and the fallback form (client).
 */
export function finalizeCheckIn(state: CheckInState): CheckInTurnResponse {
  const patient = SANDBOX_PATIENTS.find((entry) => entry.id === state.patientId) ?? SANDBOX_PATIENTS[0];
  const lastSynthetic = patient.vitals.at(-1);
  const flags = evaluateRedFlags(
    {
      weight_lbs: state.extraction.weightLbs ?? lastSynthetic?.weight ?? 0,
      sbp: state.extraction.sbp ?? lastSynthetic?.sbp ?? 0,
      spo2: state.extraction.spo2,
    },
    syntheticWeightHistory(patient),
    {
      dyspnea: state.extraction.dyspnea ?? 0,
      edema: state.extraction.edema ?? 0,
      orthopnea: state.extraction.orthopnea ?? false,
      fatigue: state.extraction.fatigue ?? 0,
    },
  );
  return {
    assistantMessages: [flags.length > 0 ? escalationMessage(flags) : routineClosingMessage(state.extraction)],
    state: { ...state, phase: 'complete' },
    done: true,
    disposition: flags.length > 0 ? 'escalated' : 'routine',
    redFlags: flags,
    fallback: false,
  };
}

/**
 * Apply one deterministic quick answer (simulated-call chips / offline path):
 * merge the fields, advance the fixed question order, and finalize after the
 * last question. Chest pain short-circuits exactly like the LLM path. No
 * model involved anywhere.
 */
export function applyDeterministicAnswer(
  state: CheckInState,
  values: Partial<CheckInExtraction>,
): CheckInTurnResponse {
  if (state.phase === 'complete') {
    return { assistantMessages: [], state, done: true, disposition: null, redFlags: [], fallback: false };
  }

  const extraction = { ...state.extraction };
  for (const key of EXTRACTION_KEYS) {
    const value = values[key];
    if (value !== undefined && value !== null) (extraction as Record<string, unknown>)[key] = value;
  }
  const base: CheckInState = { ...state, extraction, turnCount: state.turnCount + 1 };

  if (extraction.chestPainOrSyncope === true) {
    return {
      assistantMessages: [EMERGENCY_911_MESSAGE],
      state: { ...base, phase: 'complete' },
      done: true,
      disposition: 'emergency',
      redFlags: [],
      fallback: false,
    };
  }

  const nextId = nextQuestionId(state.phase);
  if (!nextId) return finalizeCheckIn(base);
  return {
    assistantMessages: [SCRIPT_QUESTIONS[nextId].canonical],
    state: { ...base, phase: nextId },
    done: false,
    disposition: null,
    redFlags: [],
    fallback: false,
  };
}

export async function runCheckInTurn(
  state: CheckInState,
  userMessage: string,
  deps: EngineDeps,
): Promise<CheckInTurnResponse> {
  if (state.phase === 'complete') {
    return { assistantMessages: [], state, done: true, disposition: null, redFlags: [], fallback: false };
  }

  const turnCount = state.turnCount + 1;
  if (turnCount > MAX_TURNS) return fallbackResponse(state);

  const current = SCRIPT_QUESTIONS[state.phase];
  const nextId = nextQuestionId(current.id);
  const llm = await deps.callModel({
    currentQuestion: current,
    nextQuestion: nextId ? SCRIPT_QUESTIONS[nextId] : null,
    reasksUsed: state.reasksUsed[current.id] ?? 0,
    visitorReply: userMessage.slice(0, MAX_MESSAGE_LENGTH),
  });
  if (!llm) return fallbackResponse(state);

  const extraction = mergeExtraction(state.extraction, llm.extracted);
  const base: CheckInState = { ...state, extraction, turnCount };

  // Emergency short-circuit is the engine's decision, never the model's.
  if (extraction.chestPainOrSyncope === true) {
    return {
      assistantMessages: [EMERGENCY_911_MESSAGE],
      state: { ...base, phase: 'complete' },
      done: true,
      disposition: 'emergency',
      redFlags: [],
      fallback: false,
    };
  }

  if (llm.say.kind === 'deflect_question') {
    return {
      assistantMessages: [DEFLECT_MESSAGE, current.canonical],
      state: base,
      done: false,
      disposition: null,
      redFlags: [],
      fallback: false,
    };
  }

  const answered = current.skippable
    || current.extractionKeys.some((key) => extraction[key] !== null);

  // Benign small talk: acknowledge warmly, then continue the script. Unlike a
  // deflection this is not a policy violation, so it never consumes the
  // re-ask budget; unlike a plain answer it always prepends the ack line.
  if (llm.say.kind === 'small_talk') {
    const ack = sanitizeSmallTalk(llm.say.smallTalk);
    if (!answered) {
      return {
        assistantMessages: [ack, current.canonical],
        state: base,
        done: false,
        disposition: null,
        redFlags: [],
        fallback: false,
      };
    }
    if (!nextId) {
      const final = finalizeCheckIn(base);
      return { ...final, assistantMessages: [ack, ...final.assistantMessages] };
    }
    const upcoming = SCRIPT_QUESTIONS[nextId];
    return {
      assistantMessages: [ack, sanitizeParaphrase(llm.say.paraphrase, upcoming.canonical)],
      state: { ...base, phase: nextId },
      done: false,
      disposition: null,
      redFlags: [],
      fallback: false,
    };
  }
  if (!answered || llm.extracted.unclear) {
    const used = state.reasksUsed[current.id] ?? 0;
    if (used < 1) {
      return {
        assistantMessages: [current.canonical],
        state: { ...base, reasksUsed: { ...state.reasksUsed, [current.id]: used + 1 } },
        done: false,
        disposition: null,
        redFlags: [],
        fallback: false,
      };
    }
    // Re-ask budget spent: leave the fields null and move on.
  }

  if (!nextId) return finalizeCheckIn(base);

  const nextQuestion = SCRIPT_QUESTIONS[nextId];
  return {
    assistantMessages: [sanitizeParaphrase(llm.say.paraphrase, nextQuestion.canonical)],
    state: { ...base, phase: nextId },
    done: false,
    disposition: null,
    redFlags: [],
    fallback: false,
  };
}
