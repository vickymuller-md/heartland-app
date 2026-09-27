import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateScanSnapshot, SCAN_RECIPE, SCAN_RULES, type ScanResult } from './scan-evaluation';

const identity = z.string().uuid();
const count = z.number().int().nonnegative();
const runSchema = z.object({ run_id: identity, slot: z.string(), calendar_timezone: z.string(), patients: count });
const pageSchema = z.object({ receipts: z.array(z.object({ receipt_id: identity, run_id: identity, rule: z.enum(SCAN_RULES) })).max(1) });
const captureSchema = z.object({ receipt_id: identity,
  state: z.enum(['captured', 'failed', 'blocked_scope', 'missed_capture_window']), snapshot: z.unknown().optional() });
const finalizationSchema = z.object({ receipt_id: identity, rule: z.string(), status: z.enum(['complete', 'blocked', 'failed', 'pending']) });
const statusSchema = z.object({ patients: count, capture_pending: count, capture_blocked: count,
  rules_pending: count, rules_blocked: count, routing_exceptions: count, rules_complete: count });
export type ScanStatus = z.infer<typeof statusSchema>;
export type ScanDrainResult = {
  complete: boolean;
  receipts_visited: number;
  processing_errors: number;
  budget_exhausted: boolean;
  status: ScanStatus | null;
};

/** Counts describe durable processing, never notification delivery or clinical review. */
export async function drainAlertScan(client: SupabaseClient, options: {
  calendarTimezone?: string; budgetMs?: number; now?: () => number;
} = {}): Promise<ScanDrainResult> {
  const now = options.now ?? Date.now;
  const deadline = now() + Math.max(0, Math.min(options.budgetMs ?? 25000, 25000));
  const seen = new Set<string>();
  const visited = new Set<string>();
  const contexts = new Map<string, ScanResult[] | null>();
  let errors = 0, exhausted = false;
  const available = () => {
    if (now() >= deadline) { exhausted = true; return false; }
    return true;
  };
  async function rpc<T>(name: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    if (!available()) throw new Error('Scan budget exhausted');
    const remaining = Math.max(1, Math.min(8000, deadline - now()));
    const { data, error } = await client.rpc(name, params).abortSignal(AbortSignal.timeout(remaining));
    if (error) throw new Error('Scan operation unconfirmed');
    return schema.parse(data);
  }
  try {
    await rpc('prepare_alert_scan', { p_calendar_timezone: options.calendarTimezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone }, runSchema);
  } catch { errors++; }
  try {
    for (let page = 0; page < 1000 && available(); page++) {
      // Advance one durable patient/rule unit, never a whole unprocessed page.
      const work = await rpc('next_alert_scan_page', { p_limit: 1 }, pageSchema);
      const receipt = work.receipts[0];
      if (!receipt) break;
      const key = receipt.receipt_id + ':' + receipt.rule;
      if (seen.has(key)) break;
      seen.add(key);
      {
        if (!available()) break;
        visited.add(receipt.receipt_id);
        try {
          if (!contexts.has(receipt.receipt_id)) {
            contexts.set(receipt.receipt_id, null);
            const capture = await rpc('capture_alert_scan_patient', { p_receipt_id: receipt.receipt_id }, captureSchema);
            if (capture.receipt_id !== receipt.receipt_id) throw new Error('Scan capture identity mismatch');
            if (capture.state === 'captured') contexts.set(receipt.receipt_id, evaluateScanSnapshot(capture.snapshot));
          }
          const results = contexts.get(receipt.receipt_id);
          if (!results) continue;
          const result = results.find((entry) => entry.rule === receipt.rule)!;
          if (result.receipt_id !== receipt.receipt_id) throw new Error('Scan source identity mismatch');
          const finalized = await rpc('finalize_alert_scan_rule', {
            p_receipt_id: receipt.receipt_id, p_recipe: SCAN_RECIPE, p_result: result,
          }, finalizationSchema);
          if (finalized.receipt_id !== receipt.receipt_id || finalized.rule !== result.rule) {
            throw new Error('Scan result identity mismatch');
          }
        } catch { errors++; }
      }
    }
  } catch { errors++; }
  // Reserve a bounded final read. Unknown totals are never an empty completed run.
  let status: ScanStatus | null = null;
  try {
    const response = await client.rpc('alert_scan_status').abortSignal(AbortSignal.timeout(3000));
    if (response.error) throw new Error('Scan status unconfirmed');
    status = statusSchema.parse(response.data);
  } catch { errors++; }
  return {
    complete: errors === 0 && status !== null && status.capture_pending === 0 && status.capture_blocked === 0
      && status.rules_pending === 0 && status.rules_blocked === 0 && status.routing_exceptions === 0,
    receipts_visited: visited.size, processing_errors: errors, budget_exhausted: exhausted, status,
  };
}
