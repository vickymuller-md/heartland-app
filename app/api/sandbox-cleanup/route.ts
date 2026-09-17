import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

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

  const { data: expired, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('role', 'tester')
    .lte('sandbox_expires_at', new Date().toISOString())
    .limit(100);
  if (error) return NextResponse.json({ error: 'Cleanup query failed' }, { status: 500 });

  let deleted = 0;
  let failed = 0;
  const failures: Array<{ id: string; stage: 'purge' | 'delete'; code: string | null }> = [];
  for (const profile of expired ?? []) {
    // Laboratory receipts and attempts are bound to the acting profile with
    // ON DELETE RESTRICT; the audited service-role erasure must run first.
    const { error: purgeError } = await supabaseAdmin.rpc('purge_expired_tester_provenance', {
      p_actor_id: profile.id,
    });
    if (purgeError) {
      failed += 1;
      failures.push({ id: profile.id, stage: 'purge', code: purgeError.code ?? null });
      continue;
    }
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(profile.id);
    if (deleteError) {
      failed += 1;
      failures.push({ id: profile.id, stage: 'delete', code: deleteError.code ?? null });
    } else {
      deleted += 1;
    }
  }

  // A failed erasure is an operator item; a non-2xx status keeps the cron run
  // visible as failed instead of a silent success.
  return NextResponse.json(
    { expired: expired?.length ?? 0, deleted, failed, failures },
    { status: failed > 0 ? 500 : 200 },
  );
}
