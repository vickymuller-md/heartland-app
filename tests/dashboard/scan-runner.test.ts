import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('server-only', () => ({}));
import { drainAlertScan, type ScanStatus } from '@/lib/dashboard/scan-runner';
import { SCAN_RECIPE, SCAN_RULES } from '@/lib/dashboard/scan-evaluation';

const id = (n: number) => `48000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const snapshot = (receipt: string) => ({ receipt_id: receipt, recipe: SCAN_RECIPE, captured_at: '2026-09-24T08:00:00Z',
  calendar_timezone: 'UTC', calendar_dates: ['2026-09-18','2026-09-19','2026-09-20','2026-09-21','2026-09-22','2026-09-23','2026-09-24'],
  sources: { checkin: { patient_created_at: '2026-08-01T00:00:00Z', latest_vital: null },
    weights: [], latest_labs: [], followups: [], acute_alerts: [], adherence: { medications: [], logs: [] } } });
const ready: ScanStatus = { patients: 0, capture_pending: 0, capture_blocked: 0, rules_pending: 0, rules_blocked: 0,
  routing_exceptions: 0, rules_complete: 0 };
function mock(handler?: (name: string, args: Record<string, unknown>) => unknown) {
  const signals: AbortSignal[] = [];
  const rpc = vi.fn((name: string, args = {}) => ({ abortSignal: (signal: AbortSignal) => {
    signals.push(signal);
    return Promise.resolve().then(() => handler ? handler(name, args) : null).then((override) => {
      if (override !== undefined && override !== null) return override;
      switch (name) {
        case 'prepare_alert_scan': return { data: { run_id: id(1), slot: '2026-09-24', calendar_timezone: 'UTC', patients: 0 }, error: null };
        case 'next_alert_scan_page': return { data: { receipts: [] }, error: null };
        case 'capture_alert_scan_patient': return { data: { receipt_id: args.p_receipt_id, state: 'captured', snapshot: snapshot(args.p_receipt_id as string) }, error: null };
        case 'finalize_alert_scan_rule': return { data: { receipt_id: args.p_receipt_id, rule: (args.p_result as {rule:string}).rule, status: 'complete' }, error: null };
        case 'alert_scan_status': return { data: ready, error: null };
        default: throw new Error('Unexpected RPC');
      }
    });
  } }));
  return { client: { rpc } as unknown as SupabaseClient, rpc, signals };
}
function cyclicPage(...receipts: string[]) {
  let cursor = 0;
  return () => {
    const position = cursor++ % (receipts.length * SCAN_RULES.length);
    return { data: { receipts: [{ receipt_id: receipts[position % receipts.length], run_id: id(1),
      rule: SCAN_RULES[Math.floor(position / receipts.length)] }] }, error: null };
  };
}

describe('durable scan runner', () => {
  it('confirms an empty run only from successful RPC status, with per-call abort bounds', async () => {
    const backend = mock();
    expect(await drainAlertScan(backend.client, { calendarTimezone: 'UTC' })).toMatchObject({ complete: true, receipts_visited: 0, processing_errors: 0 });
    expect(backend.rpc.mock.calls.map((call) => call[0])).toEqual(['prepare_alert_scan','next_alert_scan_page','alert_scan_status']);
    expect(backend.signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });
  it('processes seven stable rule identities and stops when the sweep returns only seen receipts', async () => {
    const next = cyclicPage(id(2));
    const backend = mock((name) => name === 'next_alert_scan_page' ? next() : undefined);
    const response = await drainAlertScan(backend.client);
    const finals = backend.rpc.mock.calls.filter((call) => call[0] === 'finalize_alert_scan_rule');
    expect(finals).toHaveLength(7);
    expect(finals.map((call) => (call[1] as {p_result:{rule:string}}).p_result.rule)).toEqual([...SCAN_RULES]);
    expect(finals.every((call) => (call[1] as {p_receipt_id:string}).p_receipt_id === id(2))).toBe(true);
    expect(response).toMatchObject({ complete: true, receipts_visited: 1, processing_errors: 0 });
    expect(JSON.stringify(response)).not.toContain(id(2));
  });
  it('one uncertain rule response does not stop the six others or trigger new preparation/capture', async () => {
    const next = cyclicPage(id(2));
    const backend = mock((name, args) => {
      if (name === 'next_alert_scan_page') return next();
      if (name === 'finalize_alert_scan_rule' && (args.p_result as {rule:string}).rule === 'low_adherence') throw new Error('connection lost');
    });
    const result = await drainAlertScan(backend.client);
    expect(result.complete).toBe(false); expect(result.processing_errors).toBe(1);
    expect(backend.rpc.mock.calls.filter((call) => call[0] === 'finalize_alert_scan_rule')).toHaveLength(7);
    expect(backend.rpc.mock.calls.filter((call) => call[0] === 'capture_alert_scan_patient')).toHaveLength(1);
  });
  it('continues other patients after a lost capture response', async () => {
    const next = cyclicPage(id(2), id(3));
    const backend = mock((name, args) => {
      if (name === 'next_alert_scan_page') return next();
      if (name === 'capture_alert_scan_patient' && args.p_receipt_id === id(2)) return { data: null, error: { message: 'private measurement' } };
    });
    const result = await drainAlertScan(backend.client);
    expect(result).toMatchObject({ complete: false, receipts_visited: 2, processing_errors: 1 });
    expect(backend.rpc.mock.calls.filter((call) => call[0] === 'finalize_alert_scan_rule')).toHaveLength(7);
    expect(JSON.stringify(result)).not.toContain('private measurement');
  });
  it('still drains old receipts after current-day preparation fails', async () => {
    const next = cyclicPage(id(2));
    const backend = mock((name) => {
      if (name === 'prepare_alert_scan') return { data: null, error: {} };
      if (name === 'next_alert_scan_page') return next();
    });
    const result = await drainAlertScan(backend.client);
    expect(result.complete).toBe(false); expect(result.processing_errors).toBe(1);
    expect(backend.rpc.mock.calls.filter((call) => call[0] === 'finalize_alert_scan_rule')).toHaveLength(7);
  });
  it.each(['capture_pending','capture_blocked','rules_pending','rules_blocked','routing_exceptions'] as const)
  ('does not return success with %s', async (field) => {
    const backend = mock((name) => name === 'alert_scan_status' ? { data: { ...ready, [field]: 1 }, error: null } : undefined);
    expect((await drainAlertScan(backend.client)).complete).toBe(false);
  });
  it('a failed or malformed status is unknown, not an empty complete run', async () => {
    for (const response of [{ data: null, error: {} }, { data: {}, error: null }]) {
      const backend = mock((name) => name === 'alert_scan_status' ? response : undefined);
      expect(await drainAlertScan(backend.client)).toMatchObject({ complete: false, status: null, processing_errors: 1 });
    }
  });
  it('reserves a final status read after exhausting budget and does not start unbounded work', async () => {
    let ticks = 0;
    const backend = mock();
    const result = await drainAlertScan(backend.client, { budgetMs: 1, now: () => ticks++ });
    expect(result.budget_exhausted).toBe(true); expect(result.complete).toBe(false);
    expect(backend.rpc.mock.calls.map((call) => call[0])).toEqual(['alert_scan_status']);
  });
  it('rejects mismatched capture/result identity and keeps source IDs out of the response', async () => {
    const next = cyclicPage(id(2));
    const backend = mock((name) => {
      if (name === 'next_alert_scan_page') return next();
      if (name === 'capture_alert_scan_patient') return { data: { receipt_id: id(3), state: 'captured', snapshot: snapshot(id(3)) }, error: null };
    });
    const result = await drainAlertScan(backend.client);
    expect(result.processing_errors).toBe(1);
    expect(backend.rpc.mock.calls.some((call) => call[0] === 'finalize_alert_scan_rule')).toBe(false);
    expect(JSON.stringify(result)).not.toContain('48000000');
  });
  it('does not finalize blocked scope or missed captures', async () => {
    for (const state of ['blocked_scope','missed_capture_window','failed']) {
      const next = cyclicPage(id(2));
      const backend = mock((name) => {
        if (name === 'next_alert_scan_page') return next();
        if (name === 'capture_alert_scan_patient') return { data: { receipt_id: id(2), state }, error: null };
        if (name === 'alert_scan_status') return { data: { ...ready, capture_blocked: 1 }, error: null };
      });
      expect((await drainAlertScan(backend.client)).complete).toBe(false);
      expect(backend.rpc.mock.calls.some((call) => call[0] === 'finalize_alert_scan_rule')).toBe(false);
    }
  });
  it('visits every patient and rule across short invocations even when every first attempt is slow and fails', async () => {
    const patients = Array.from({ length: 20 }, (_, index) => id(index + 2));
    const next = cyclicPage(...patients);
    let elapsed = 0;
    const attempts: string[] = [];
    const backend = mock((name, args) => {
      if (name === 'next_alert_scan_page') { expect(args.p_limit).toBe(1); return next(); }
      if (name === 'finalize_alert_scan_rule') {
        attempts.push(String(args.p_receipt_id) + ':' + (args.p_result as {rule:string}).rule);
        elapsed += 100;
        return { data: null, error: { message: 'synthetic slow failure' } };
      }
      if (name === 'alert_scan_status') return { data: { ...ready, rules_pending: 140 }, error: null };
    });
    for (let invocation = 0; invocation < 140; invocation++) {
      elapsed = 0;
      const result = await drainAlertScan(backend.client, { budgetMs: 50, now: () => elapsed });
      expect(result).toMatchObject({ complete: false, budget_exhausted: true, receipts_visited: 1 });
    }
    expect(attempts).toHaveLength(140);
    expect(new Set(attempts).size).toBe(140);
    for (const patient of patients) for (const rule of SCAN_RULES) expect(attempts).toContain(patient + ':' + rule);
  });
});
