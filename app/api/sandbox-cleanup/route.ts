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
  for (const profile of expired ?? []) {
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(profile.id);
    if (deleteError) failed += 1;
    else deleted += 1;
  }

  return NextResponse.json({ expired: expired?.length ?? 0, deleted, failed });
}
