import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { z } from 'zod';
import { labReceiptRowsSchema } from '@/lib/labs/evaluation';

export const dynamic = 'force-dynamic';

// Operational drain of laboratory alert evaluations that stayed pending because the
// in-request processing failed or never ran. Recording an alert signal here is a
// database event only: it is not notification delivery, human review or care.
const BATCH_LIMIT = 50;
const MAX_ATTEMPTS = 5;

function validCronAuthorization(header: string | null, secret: string): boolean {
  const actual = Buffer.from(header ?? '', 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  if (!validCronAuthorization(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Activation is an explicit operational decision after the queue is reviewed.
  if (process.env.LAB_ALERT_DRAIN_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Laboratory alert drain is disabled' }, { status: 503 });
  }

  let pending: Array<{ id: string; lab_result_id: string; attempt_count: number }>;
  let exhausted: string[]; let exhaustedCount: number;
  try {
    // Exhausted rows must not occupy the eligible batch. Counts are operational
    // snapshots, not a claim that the entire queue is empty or drained atomically.
    const [eligible, old] = await Promise.all([
      supabaseAdmin.from('lab_alert_evaluations').select('id, lab_result_id, attempt_count')
        .eq('status', 'pending').lt('attempt_count', MAX_ATTEMPTS)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(BATCH_LIMIT),
      supabaseAdmin.from('lab_alert_evaluations').select('id', { count: 'exact' })
        .eq('status', 'pending').gte('attempt_count', MAX_ATTEMPTS)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(BATCH_LIMIT),
    ]);
    if (eligible.error || old.error) throw new Error('Query failed');
    pending = z.array(z.object({ id: z.guid(), lab_result_id: z.guid(),
      attempt_count: z.number().int().min(0).max(MAX_ATTEMPTS - 1) }).strict()).max(BATCH_LIMIT).parse(eligible.data);
    exhausted = z.array(z.object({ id: z.guid() }).strict()).max(BATCH_LIMIT).parse(old.data).map((row) => row.id);
    exhaustedCount = z.number().int().min(exhausted.length).parse(old.count);
    if (new Set(pending.map((row) => row.id)).size !== pending.length
      || new Set(pending.map((row) => row.lab_result_id)).size !== pending.length
      || new Set(exhausted).size !== exhausted.length
      || exhausted.length !== Math.min(exhaustedCount, BATCH_LIMIT)) throw new Error('Invalid drain batch');
  } catch { return NextResponse.json({ error: 'Drain query failed' }, { status: 500 }); }

  const counts = { pending: pending.length, recorded: 0, not_required: 0, invalidated: 0,
    still_pending: 0, exhausted: exhaustedCount, rpc_failed: 0 };
  const rpcFailures: string[] = [];
  for (const evaluation of pending) {
    try {
      const { data, error } = await supabaseAdmin.rpc('process_lab_alert_event', { p_lab_result_id: evaluation.lab_result_id });
      const rows = labReceiptRowsSchema.parse(data);
      const receipt = rows[0];
      if (error || receipt.lab_result_id !== evaluation.lab_result_id || receipt.event_id !== evaluation.id) throw new Error('Unconfirmed evaluation');
      if (receipt.status === 'pending') counts.still_pending += 1;
      else counts[receipt.status] += 1;
    } catch {
      counts.rpc_failed += 1; rpcFailures.push(evaluation.id);
    }
  }

  // Exhausted or failing evaluations need a human operator; a non-2xx status keeps
  // the scheduled run visible as failed instead of a silent success.
  const needsOperator = counts.exhausted > 0 || counts.rpc_failed > 0 || counts.still_pending > 0;
  return NextResponse.json(
    { ...counts, exhausted_ids: exhausted, exhausted_sample_truncated: exhaustedCount > exhausted.length, rpc_failed_ids: rpcFailures },
    { status: needsOperator ? 500 : 200 },
  );
}
