import { z } from 'zod';
import { RED_FLAG_CRITERIA } from './constants';
import { evaluateRedFlags } from './red-flags';
import type { RedFlag } from './types';

export const VITALS_RULE_VERSION = 'vitals-frozen-individual-v1';
export const BATCH_VITALS_RULE_VERSION = 'vitals-frozen-batch-v1';
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const historyEntry = z.object({
  id: z.string().uuid(), recorded_at: timestamp,
  // Missing historical weight is not a zero or an invented normal reading.
  weight_lbs: z.number().finite().nullable(),
});
const receiptSchema = z.object({
  context_version: z.literal(1), captured_at: timestamp,
  observation: z.object({
    vitals: z.object({
      id: z.string().uuid(), recorded_at: timestamp, weight_lbs: z.number().finite(),
      sbp: z.number().int(), spo2: z.number().int().nullable(),
    }),
    symptoms: z.object({ dyspnea: z.number().int(), edema: z.number().int(),
      orthopnea: z.boolean(), fatigue: z.number().int() }),
  }),
  history: z.array(historyEntry).max(1000),
});

export class IncompleteVitalsHistoryError extends Error {
  constructor(public readonly observedFlags: RedFlag[]) { super('Incomplete weight history'); }
}

// PostgreSQL timestamps preserve microseconds. Date.parse alone collapses two
// distinct observations inside one millisecond and can change the scale guard.
function instantMicroseconds(value: string): bigint {
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] ?? '';
  return BigInt(Date.parse(value)) * BigInt(1000) + BigInt(fraction.padEnd(6, '0').slice(3, 6));
}

/** Freeze the existing individual query recipe: 7 days, current row included,
 * descending observation time; same-instant ties now have a stable ID order.
 * No new backdated/future-observation or scale-malfunction clinical policy.
 */
export function evaluateCapturedVitals(raw: unknown): RedFlag[] {
  const receipt = receiptSchema.parse(raw);
  const captured = new Date(receipt.captured_at);
  const cutoff = captured.getTime() - 7 * 86_400_000;
  const current = receipt.observation.vitals;
  const history = [...receipt.history, current]
    .filter((row) => Date.parse(row.recorded_at) >= cutoff)
    .sort((a, b) => {
      const delta = instantMicroseconds(b.recorded_at) - instantMicroseconds(a.recorded_at);
      return delta > BigInt(0) ? 1 : delta < BigInt(0) ? -1 : b.id.localeCompare(a.id);
    });
  // Legacy storage allowed a null weight; never silently coerce it to zero or
  // discard it and call that complete evaluation. Keep the receipt retryable.
  if (history.some((row) => row.weight_lbs === null)) {
    throw new IncompleteVitalsHistoryError(evaluateRedFlags(current, [], receipt.observation.symptoms, captured));
  }
  return evaluateRedFlags(current, history as Array<{ weight_lbs: number; recorded_at: string }>,
    receipt.observation.symptoms, captured);
}

export function flagsFromReceipt(ids: unknown): RedFlag[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !Object.hasOwn(RED_FLAG_CRITERIA, id))) {
    throw new Error('Invalid evaluated flag receipt');
  }
  return ids.map((id) => {
    const criterion = RED_FLAG_CRITERIA[id as keyof typeof RED_FLAG_CRITERIA];
    return { id: criterion.id, severity: criterion.severity, message: criterion.message, action: criterion.action };
  });
}

/** Batch recipe is deliberately prior-only and preserves prepend/form order.
 * Do not sort, include the current row, or trim its scale-guard context to7days.
 */
export function evaluateCapturedBatchVitals(raw: unknown, frozenHistory: unknown): RedFlag[] {
  const receipt = receiptSchema.parse(raw);
  const history = z.array(historyEntry).max(1006).parse(frozenHistory);
  if (history.some((row) => row.id === receipt.observation.vitals.id)) throw new Error('Invalid batch context');
  const captured = new Date(receipt.captured_at);
  if (history.some((row) => row.weight_lbs === null)) {
    throw new IncompleteVitalsHistoryError(evaluateRedFlags(receipt.observation.vitals, [], receipt.observation.symptoms, captured));
  }
  return evaluateRedFlags(receipt.observation.vitals, history as Array<{ weight_lbs: number; recorded_at: string }>,
    receipt.observation.symptoms, captured);
}
