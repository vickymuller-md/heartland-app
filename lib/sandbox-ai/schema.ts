/**
 * Sandbox AI-Assisted Check-In -- Validation Schemas
 *
 * Every LLM output and every request body crosses one of these strict
 * schemas. Anything outside the shape is discarded (deterministic fallback),
 * never rendered and never stored.
 */

import { z } from 'zod';
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
};

export const llmTurnSchema = z
  .object({
    say: z
      .object({
        kind: z.enum(['question', 'ack_question', 'deflect_question']),
        paraphrase: z.string().min(1).max(280),
      })
      .strict(),
    extracted: z.object({ ...extractionShape, unclear: z.boolean() }).strict(),
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
]);

export const checkInStateSchema = z
  .object({
    patientId: z.string().min(1).max(40),
    phase: z.enum([...questionIdSchema.options, 'complete']),
    extraction: z.object(extractionShape).strict(),
    reasksUsed: z.partialRecord(questionIdSchema, z.number().int().min(0).max(2)),
    turnCount: z.number().int().min(0).max(40),
  })
  .strict();

export const checkInRequestSchema = z
  .object({
    state: checkInStateSchema,
    message: z.string().min(1).max(500),
    anonymousSessionId: z.uuid().optional(),
  })
  .strict();

// ── Simulated outreach call (one-shot generation) ────────────

export const simulatedCallSchema = z
  .object({
    turns: z
      .array(z.object({
        speaker: z.enum(['assistant', 'patient']),
        text: z.string().min(1).max(300),
      }).strict())
      .min(6)
      .max(24),
    extracted: z.object(extractionShape).strict(),
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
  .object({ anonymousSessionId: z.uuid().optional() })
  .strict();

/** JSON Schema mirror of llmTurnSchema for the forced Anthropic tool call. */
export const CHECK_IN_TURN_TOOL_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['say', 'extracted'],
  properties: {
    say: {
      type: 'object' as const,
      additionalProperties: false,
      required: ['kind', 'paraphrase'],
      properties: {
        kind: { enum: ['question', 'ack_question', 'deflect_question'] },
        paraphrase: { type: 'string', maxLength: 280 },
      },
    },
    extracted: {
      type: 'object' as const,
      additionalProperties: false,
      required: [
        'weightLbs', 'sbp', 'spo2', 'dyspnea', 'edema', 'orthopnea',
        'fatigue', 'adherence', 'chestPainOrSyncope', 'unclear',
      ],
      properties: {
        weightLbs: { type: ['number', 'null'], minimum: 50, maximum: 500 },
        sbp: { type: ['integer', 'null'], minimum: 50, maximum: 260 },
        spo2: { type: ['integer', 'null'], minimum: 50, maximum: 100 },
        dyspnea: { type: ['integer', 'null'], minimum: 0, maximum: 3 },
        edema: { type: ['integer', 'null'], minimum: 0, maximum: 3 },
        orthopnea: { type: ['boolean', 'null'] },
        fatigue: { type: ['integer', 'null'], minimum: 0, maximum: 3 },
        adherence: { enum: ['yes', 'missed_some', 'no', null] },
        chestPainOrSyncope: { type: ['boolean', 'null'] },
        unclear: { type: 'boolean' },
      },
    },
  },
};

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
