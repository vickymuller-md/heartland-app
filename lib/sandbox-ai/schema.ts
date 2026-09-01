/**
 * Sandbox AI-Assisted Check-In -- Validation Schemas
 *
 * Every LLM output and every request body crosses one of these strict
 * schemas. Anything outside the shape is discarded (deterministic fallback),
 * never rendered and never stored.
 */

import { z } from 'zod';
import { containsClinicalAdvice, containsObviousIdentifier } from './safety';
import type { LlmTurn } from './types';

const severity = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const extractionShape = {
  weightLbs: z.number().min(50).max(500).nullable(),
  sbp: z.number().int().min(50).max(260).nullable(),
  spo2: z.number().int().min(50).max(100).nullable(),
  dyspnea: severity.nullable(),
  edema: severity.nullable(),
  orthopnea: z.boolean().nullable(),
  fatigue: severity.nullable(),
  adherence: z.enum(['yes', 'missed_some', 'no']).nullable(),
  chestPainOrSyncope: z.boolean().nullable(),
  hr: z.number().int().min(30).max(220).nullable(),
  dizziness: severity.nullable(),
  worseSymptoms: z.boolean().nullable(),
};

export const llmTurnSchema = z
  .object({
    say: z
      .object({
        kind: z.enum(['question', 'ack_question', 'deflect_question', 'small_talk']),
        paraphrase: z.string().min(1).max(280),
        smallTalk: z.string().max(280).nullable(),
      })
      .strict(),
    // Partial: the forced tool schema only exposes the active script's fields.
    extracted: z.object(extractionShape).partial().extend({ unclear: z.boolean() }).strict(),
  })
  .strict();

export type LlmTurnParsed = z.infer<typeof llmTurnSchema>;

/**
 * Defense in depth on the only free text the LLM can surface: reject links,
 * markup, and medication/dose language regardless of what the prompt allowed.
 * Rejection falls back to the canonical script wording -- the chat continues.
 */
const PARAPHRASE_BLOCKLIST = /(https?:|www\.|\[|`|<|>|\b(mg|mcg|dose|doses|tablet|tablets|pill|pills)\b)/i;

export function sanitizeParaphrase(paraphrase: string, canonical: string): string {
  const cleaned = paraphrase.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0 || cleaned.length > 280) return canonical;
  if (PARAPHRASE_BLOCKLIST.test(cleaned)) return canonical;
  if (containsClinicalAdvice(cleaned) || containsObviousIdentifier(cleaned)) return canonical;
  return cleaned;
}

/**
 * Small talk may chat back — including ONE light social question — but a
 * question is never allowed to steer toward health, symptoms, medication, or
 * care (that is the scripted check-in's job, and health probing outside the
 * registered script would be the model making clinical moves). Rejection
 * falls back to a fixed warm ack.
 */
export const SMALL_TALK_FALLBACK_ACK = 'That sounds lovely — thank you for sharing.';
export const SMALL_TALK_FALLBACK_ACK_ES = 'Qué lindo — gracias por compartirlo.';

/** Applied only when the small talk contains a question mark (en + es). */
const SOCIAL_QUESTION_BLOCKLIST =
  /(symptom|síntoma|sintoma|breath|respir|chest|pecho|swell|hinch|weight|peso|medic|pastilla|remedio|sleep|dorm|dizz|mare|pain|dolor|tired|cansad|doctor|nurse|enfermer|hospital|feel(ing)? (better|worse)|se siente|cómo está de)/i;

export function sanitizeSmallTalk(reply: string | null, locale: 'en' | 'es' = 'en'): string {
  const fallback = locale === 'es' ? SMALL_TALK_FALLBACK_ACK_ES : SMALL_TALK_FALLBACK_ACK;
  const cleaned = (reply ?? '').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0 || cleaned.length > 280) return fallback;
  if (PARAPHRASE_BLOCKLIST.test(cleaned)) return fallback;
  if (containsClinicalAdvice(cleaned) || containsObviousIdentifier(cleaned)) return fallback;
  const questionMarks = (cleaned.match(/\?/g) ?? []).length;
  if (questionMarks > 1) return fallback;
  if (questionMarks === 1 && SOCIAL_QUESTION_BLOCKLIST.test(cleaned)) return fallback;
  return cleaned;
}

export function parseLlmTurn(input: unknown): LlmTurn | null {
  const parsed = llmTurnSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

// ── Request body (public endpoint) ───────────────────────────

// Literal list kept in sync with ScriptQuestionId by the type annotations below.
const questionIdSchema = z.enum([
  'q1_safety', 'q2_weight', 'q3_breathing', 'q4_swelling',
  'q5_orthopnea', 'q6_fatigue', 'q7_adherence', 'q8_devices',
  't1_safety', 't2_dizziness', 't3_sbp', 't4_hr', 't5_symptoms', 't6_adherence',
]);

export const checkInStateSchema = z
  .object({
    patientId: z.string().min(1).max(40),
    // Defaults keep pre-multi-script clients and fixtures valid.
    scriptId: z.enum(['daily_checkin', 'titration_followup']).default('daily_checkin'),
    locale: z.enum(['en', 'es']).default('en'),
    phase: z.enum([...questionIdSchema.options, 'complete']),
    extraction: z.object(extractionShape).strict(),
    reasksUsed: z.partialRecord(questionIdSchema, z.number().int().min(0).max(2)),
    turnCount: z.number().int().min(0).max(40),
    /** Pure-chat turns spent this call; default keeps pre-v1.9 clients valid. */
    chatTurnsUsed: z.number().int().min(0).max(4).default(0),
  })
  .strict();

export const checkInRequestSchema = z
  .object({
    state: checkInStateSchema,
    message: z.string().min(1).max(500),
    anonymousSessionId: z.uuid().optional(),
    /** Simulated live call: also return per-message audio (clip refs / synthesized MP3). */
    wantSpeech: z.boolean().optional(),
  })
  .strict();

// ── Simulated outreach call (one-shot generation) ────────────

// The outreach demonstration always runs the daily check-in script, so the
// model reports exactly the daily fields (mirrors SIMULATED_CALL_TOOL_SCHEMA).
const dailyExtractionShape = {
  weightLbs: extractionShape.weightLbs,
  sbp: extractionShape.sbp,
  spo2: extractionShape.spo2,
  dyspnea: extractionShape.dyspnea,
  edema: extractionShape.edema,
  orthopnea: extractionShape.orthopnea,
  fatigue: extractionShape.fatigue,
  adherence: extractionShape.adherence,
  chestPainOrSyncope: extractionShape.chestPainOrSyncope,
};

export const simulatedCallSchema = z
  .object({
    turns: z
      .array(z.object({
        speaker: z.enum(['assistant', 'patient']),
        text: z.string().min(1).max(300),
      }).strict())
      .min(6)
      .max(24),
    extracted: z.object(dailyExtractionShape).strict(),
  })
  .strict();

export type SimulatedCallParsed = z.infer<typeof simulatedCallSchema>;

/** Provider-facing transcript text: strip links and markup; length is schema-capped. */
export function sanitizeTranscriptText(text: string): string {
  return text
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/[<>[\]`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSimulatedCall(input: unknown): SimulatedCallParsed | null {
  const parsed = simulatedCallSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const simulateCallRequestSchema = z
  .object({
    anonymousSessionId: z.uuid().optional(),
    /** Copilot morning round: run one specific persona instead of a random one. */
    scenarioId: z.enum(['scenario-stable-elder', 'scenario-weight-gain', 'scenario-adherence-barrier']).optional(),
  })
  .strict();

/** JSON Schema fragments for every extractable field (superset of all scripts). */
const EXTRACTION_PROPERTY_SCHEMAS: Record<string, object> = {
  weightLbs: { type: ['number', 'null'], minimum: 50, maximum: 500 },
  sbp: { type: ['integer', 'null'], minimum: 50, maximum: 260 },
  spo2: { type: ['integer', 'null'], minimum: 50, maximum: 100 },
  dyspnea: { type: ['integer', 'null'], minimum: 0, maximum: 3 },
  edema: { type: ['integer', 'null'], minimum: 0, maximum: 3 },
  orthopnea: { type: ['boolean', 'null'] },
  fatigue: { type: ['integer', 'null'], minimum: 0, maximum: 3 },
  adherence: { enum: ['yes', 'missed_some', 'no', null] },
  chestPainOrSyncope: { type: ['boolean', 'null'] },
  hr: { type: ['integer', 'null'], minimum: 30, maximum: 220 },
  dizziness: { type: ['integer', 'null'], minimum: 0, maximum: 3 },
  worseSymptoms: { type: ['boolean', 'null'] },
};

/** Forced tool schema exposing only the active script's extraction fields. */
export function checkInToolSchemaFor(keys: ReadonlyArray<string>) {
  return {
    type: 'object' as const,
    additionalProperties: false,
    required: ['say', 'extracted'],
    properties: {
      say: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['kind', 'paraphrase', 'smallTalk'],
        properties: {
          kind: { enum: ['question', 'ack_question', 'deflect_question', 'small_talk'] },
          paraphrase: { type: 'string', maxLength: 280 },
          smallTalk: { type: ['string', 'null'], maxLength: 280 },
        },
      },
      extracted: {
        type: 'object' as const,
        additionalProperties: false,
        required: [...keys, 'unclear'],
        properties: {
          ...Object.fromEntries(keys.map((key) => [key, EXTRACTION_PROPERTY_SCHEMAS[key]])),
          unclear: { type: 'boolean' },
        },
      },
    },
  };
}

const DAILY_CHECKIN_KEYS = [
  'weightLbs', 'sbp', 'spo2', 'dyspnea', 'edema', 'orthopnea',
  'fatigue', 'adherence', 'chestPainOrSyncope',
] as const;

/** JSON Schema mirror of llmTurnSchema for the daily check-in (legacy name). */
export const CHECK_IN_TURN_TOOL_SCHEMA = checkInToolSchemaFor(DAILY_CHECKIN_KEYS);

const EXTRACTED_FIELDS_SCHEMA = {
  ...CHECK_IN_TURN_TOOL_SCHEMA.properties.extracted,
  required: CHECK_IN_TURN_TOOL_SCHEMA.properties.extracted.required.filter((key) => key !== 'unclear'),
  properties: Object.fromEntries(
    Object.entries(CHECK_IN_TURN_TOOL_SCHEMA.properties.extracted.properties).filter(([key]) => key !== 'unclear'),
  ),
};

/** JSON Schema mirror of simulatedCallSchema for the forced Anthropic tool call. */
export const SIMULATED_CALL_TOOL_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['turns', 'extracted'],
  properties: {
    turns: {
      type: 'array' as const,
      minItems: 6,
      maxItems: 24,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['speaker', 'text'],
        properties: {
          speaker: { enum: ['assistant', 'patient'] },
          text: { type: 'string', maxLength: 300 },
        },
      },
    },
    extracted: EXTRACTED_FIELDS_SCHEMA,
  },
};
