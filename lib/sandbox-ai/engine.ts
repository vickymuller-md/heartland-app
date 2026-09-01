/**
 * Sandbox AI-Assisted Calls -- Deterministic Controller
 *
 * Owns question order, re-asks, the chest-pain emergency short-circuit, and
 * final disposition for every registered call script (call-scripts.ts). The
 * LLM (deps.callModel) only paraphrases the next question, acknowledges
 * benign small talk, and extracts structured data; every completion decision
 * runs through the script's registered deterministic rules. Pure module: the
 * fallback form reuses finalizeCheckIn client-side with identical results.
 */

import { scriptFor } from './call-scripts';
import { sanitizeParaphrase, sanitizeSmallTalk } from './schema';
import { deflectMessageFor, emergencyMessageFor } from './script';
import { canonicalFor } from './types';
import type {
  CallLocale,
  CheckInExtraction,
  CheckInState,
  CheckInTurnResponse,
  LlmTurn,
  ScriptId,
  ScriptQuestion,
  ScriptQuestionId,
} from './types';

// Compat re-exports: these lived here before the multi-script split.
export { finalizeCheckIn, syntheticWeightHistory } from './daily-script';

export const MAX_TURNS = 30;
/** Pure-chat turns (small talk without answering) allowed per call. */
export const MAX_CHAT_TURNS = 4;
const MAX_MESSAGE_LENGTH = 500;

const EXTRACTION_KEYS: ReadonlyArray<keyof CheckInExtraction> = [
  'weightLbs', 'sbp', 'spo2', 'dyspnea', 'edema', 'orthopnea',
  'fatigue', 'adherence', 'chestPainOrSyncope', 'hr', 'dizziness', 'worseSymptoms',
];

export interface EngineDeps {
  callModel: (input: {
    scriptId: ScriptId;
    locale: CallLocale;
    currentQuestion: ScriptQuestion;
    nextQuestion: ScriptQuestion | null;
    reasksUsed: number;
    chatBudgetRemaining: number;
    visitorReply: string;
  }) => Promise<LlmTurn | null>;
}

export function emptyExtraction(): CheckInExtraction {
  return {
    weightLbs: null, sbp: null, spo2: null, dyspnea: null, edema: null,
    orthopnea: null, fatigue: null, adherence: null, chestPainOrSyncope: null,
    hr: null, dizziness: null, worseSymptoms: null,
  };
}

export function createInitialState(
  patientId: string,
  scriptId: ScriptId = 'daily_checkin',
  locale: CallLocale = 'en',
): CheckInState {
  return {
    patientId,
    scriptId,
    locale,
    phase: scriptFor(scriptId).order[0],
    extraction: emptyExtraction(),
    reasksUsed: {},
    turnCount: 0,
  };
}

function nextQuestionIdIn(order: readonly ScriptQuestionId[], current: ScriptQuestionId): ScriptQuestionId | null {
  const index = order.indexOf(current);
  return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
}

function mergeExtraction(base: CheckInExtraction, incoming: Partial<CheckInExtraction>): CheckInExtraction {
  const merged = { ...base };
  for (const key of EXTRACTION_KEYS) {
    const value = incoming[key];
    if (value !== null && value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

function fallbackResponse(state: CheckInState): CheckInTurnResponse {
  return { assistantMessages: [], state, done: false, disposition: null, redFlags: [], fallback: true };
}

function emergencyResponse(state: CheckInState): CheckInTurnResponse {
  return {
    assistantMessages: [emergencyMessageFor(state.locale)],
    state: { ...state, phase: 'complete' },
    done: true,
    disposition: 'emergency',
    redFlags: [],
    fallback: false,
  };
}

/**
 * Apply one deterministic quick answer (simulated-call chips / offline path):
 * merge the fields, advance the script's fixed question order, and finalize
 * after the last question. Chest pain short-circuits exactly like the LLM
 * path. No model involved anywhere.
 */
export function applyDeterministicAnswer(
  state: CheckInState,
  values: Partial<CheckInExtraction>,
): CheckInTurnResponse {
  if (state.phase === 'complete') {
    return { assistantMessages: [], state, done: true, disposition: null, redFlags: [], fallback: false };
  }
  const script = scriptFor(state.scriptId);

  const extraction = mergeExtraction(state.extraction, values);
  const base: CheckInState = { ...state, extraction, turnCount: state.turnCount + 1 };

  if (extraction.chestPainOrSyncope === true) return emergencyResponse(base);

  const nextId = nextQuestionIdIn(script.order, state.phase);
  if (!nextId) return script.finalize(base);
  const nextQuestion = script.questions[nextId];
  return {
    assistantMessages: [nextQuestion ? canonicalFor(nextQuestion, state.locale) : ''],
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
  const script = scriptFor(state.scriptId);
  const current = script.questions[state.phase];
  if (!current) return fallbackResponse(state);

  const turnCount = state.turnCount + 1;
  if (turnCount > MAX_TURNS) return fallbackResponse(state);

  const nextId = nextQuestionIdIn(script.order, current.id);
  const llm = await deps.callModel({
    scriptId: state.scriptId,
    locale: state.locale,
    currentQuestion: current,
    nextQuestion: nextId ? script.questions[nextId] ?? null : null,
    reasksUsed: state.reasksUsed[current.id] ?? 0,
    chatBudgetRemaining: Math.max(0, MAX_CHAT_TURNS - (state.chatTurnsUsed ?? 0)),
    visitorReply: userMessage.slice(0, MAX_MESSAGE_LENGTH),
  });
  if (!llm) return fallbackResponse(state);

  const extraction = mergeExtraction(state.extraction, llm.extracted);
  const base: CheckInState = { ...state, extraction, turnCount };
  const currentCanonical = canonicalFor(current, state.locale);

  // Emergency short-circuit is the engine's decision, never the model's.
  if (extraction.chestPainOrSyncope === true) return emergencyResponse(base);

  if (llm.say.kind === 'deflect_question') {
    return {
      assistantMessages: [deflectMessageFor(state.locale), currentCanonical],
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
    const ack = sanitizeSmallTalk(llm.say.smallTalk, state.locale);
    if (!answered) {
      // Pure chat: within the deterministic budget the assistant just talks —
      // no canonical question appended, the script phase holds, and the next
      // turn returns to the check-in. The budget (not the model) decides when
      // chatting stops being an option.
      const chatTurnsUsed = state.chatTurnsUsed ?? 0;
      if (chatTurnsUsed < MAX_CHAT_TURNS) {
        return {
          assistantMessages: [ack],
          state: { ...base, chatTurnsUsed: chatTurnsUsed + 1 },
          done: false,
          disposition: null,
          redFlags: [],
          fallback: false,
        };
      }
      return {
        assistantMessages: [ack, currentCanonical],
        state: base,
        done: false,
        disposition: null,
        redFlags: [],
        fallback: false,
      };
    }
    if (!nextId) {
      const final = script.finalize(base);
      return { ...final, assistantMessages: [ack, ...final.assistantMessages] };
    }
    const upcoming = script.questions[nextId];
    const upcomingCanonical = upcoming ? canonicalFor(upcoming, state.locale) : '';
    return {
      assistantMessages: [ack, sanitizeParaphrase(llm.say.paraphrase, upcomingCanonical)],
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
        assistantMessages: [currentCanonical],
        state: { ...base, reasksUsed: { ...state.reasksUsed, [current.id]: used + 1 } },
        done: false,
        disposition: null,
        redFlags: [],
        fallback: false,
      };
    }
    // Re-ask budget spent: leave the fields null and move on.
  }

  if (!nextId) return script.finalize(base);

  const nextQuestion = script.questions[nextId];
  const nextCanonical = nextQuestion ? canonicalFor(nextQuestion, state.locale) : '';
  return {
    assistantMessages: [sanitizeParaphrase(llm.say.paraphrase, nextCanonical)],
    state: { ...base, phase: nextId },
    done: false,
    disposition: null,
    redFlags: [],
    fallback: false,
  };
}
