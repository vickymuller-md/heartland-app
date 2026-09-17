import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

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

  const { data: pending, error } = await supabaseAdmin
    .from('lab_alert_evaluations')
    .select('id, lab_result_id, attempt_count')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) return NextResponse.json({ error: 'Drain query failed' }, { status: 500 });

  const counts = { pending: pending?.length ?? 0, recorded: 0, not_required: 0, still_pending: 0, exhausted: 0, rpc_failed: 0 };
  const exhausted: string[] = [];
  const rpcFailures: string[] = [];
  for (const evaluation of pending ?? []) {
    if (evaluation.attempt_count >= MAX_ATTEMPTS) {
      counts.exhausted += 1;
      exhausted.push(evaluation.id);
      continue;
    }
    const { data, error: rpcError } = await supabaseAdmin.rpc('process_lab_alert_event', {
      p_lab_result_id: evaluation.lab_result_id,
    });
    if (rpcError) {
      counts.rpc_failed += 1;
      rpcFailures.push(evaluation.id);
      continue;
    }
    const status = Array.isArray(data) ? data[0]?.status : undefined;
    if (status === 'recorded') counts.recorded += 1;
    else if (status === 'not_required') counts.not_required += 1;
    else counts.still_pending += 1;
  }

  // Exhausted or failing evaluations need a human operator; a non-2xx status keeps
  // the scheduled run visible as failed instead of a silent success.
  const needsOperator = counts.exhausted > 0 || counts.rpc_failed > 0;
  return NextResponse.json(
    { ...counts, exhausted_ids: exhausted, rpc_failed_ids: rpcFailures },
    { status: needsOperator ? 500 : 200 },
  );
}
