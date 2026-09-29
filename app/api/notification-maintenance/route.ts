import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const resultSchema = z.object({
  status: z.literal('complete'),
  scanned: z.number().int().min(0).max(10),
  erased: z.number().int().min(0).max(10),
  retained: z.number().int().min(0).max(10),
  receiptsExpired: z.number().int().nonnegative(),
}).strict().refine((r) => r.scanned === r.erased + r.retained);

/** Only explicitly enrolled disposable synthetic work. Enrollment is a separate
 * service operation, never inferred from query parameters, age or user roles.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Notification maintenance is not configured' }, { status: 503 });
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.NOTIFICATION_RETENTION_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Notification maintenance is disabled' }, { status: 503 });
  }
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const { data, error } = await supabaseAdmin.rpc('maintain_synthetic_notifications', { p_limit: 10 })
      .abortSignal(AbortSignal.timeout(12_000));
    const result = resultSchema.safeParse(data);
    if (error || !result.success) throw new Error('Maintenance incomplete');
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // No IDs, endpoints, payloads, database errors or false zero-success response.
    return NextResponse.json({ error: 'Notification maintenance is unavailable' }, { status: 503 });
  }
}
