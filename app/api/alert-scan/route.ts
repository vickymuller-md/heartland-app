/** Daily08:00UTC preparation plus bounded recovery of existing scan receipts.
 * Explicit cutover gate: enable only after schema, exceptions and queue release review.
 * Detection does not consult mute preferences or send notifications.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { drainAlertScan } from '@/lib/dashboard/scan-runner';

export const dynamic = 'force-dynamic';

function validCronAuthorization(header: string | null, secret: string): boolean {
  const actual = Buffer.from(header ?? '', 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error('[alert-scan] CRON_SECRET is not configured -- cron cannot authenticate');
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  if (!validCronAuthorization(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.ALERT_SCAN_RECOVERY_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Recoverable scan cutover is not enabled' }, { status: 503 });
  }
  try {
    const result = await drainAlertScan(supabaseAdmin);
    return NextResponse.json(result, { status: result.complete ? 200 : 503 });
  } catch {
    console.error('[alert-scan] Processing status unavailable');
    return NextResponse.json({ error: 'Scan processing status unavailable' }, { status: 503 });
  }
}
