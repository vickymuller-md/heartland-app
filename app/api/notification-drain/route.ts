import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dispatchOne } from '@/lib/notifications/dispatch-worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Five RPC deadlines (5s each) + one HTTP deadline (10s) fit below60s.
// The database lease is120s; late/lost results remain unknown rather than replayed.
export const maxDuration = 60;

/** Manual controlled-evaluation entry, not scheduled by this batch. One explicitly
 * allowed synthetic intent per request. No query/body can expand the allowlist.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Notification service is not configured' }, { status: 503 });
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.NOTIFICATION_DISPATCH_ENABLED !== 'true'
    || process.env.LEGACY_ALERT_TRANSPORT_ENABLED === 'true') {
    return NextResponse.json({ error: 'Notification dispatch is disabled' }, { status: 503 });
  }
  const ids = z.array(z.uuid()).min(1).max(25).safeParse(process.env.NOTIFICATION_DISPATCH_INTENT_IDS?.split(',').map((id) => id.trim()));
  const requested = new URL(request.url).searchParams.get('intent');
  if (!ids.success || !requested || !ids.data.includes(requested)) {
    return NextResponse.json({ error: 'Controlled notification intent is not configured' }, { status: 503 });
  }
  try {
    // Default OFF exits before loading an admin client or credentials-dependent adapter.
    const [{ supabaseAdmin }, { notificationRepository }, { notificationTransport }] = await Promise.all([
      import('@/lib/supabase/admin'), import('@/lib/notifications/dispatch-repository'), import('@/lib/notifications/dispatch-transport'),
    ]);
    const config = { vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      vapidPrivateKey: process.env.VAPID_PRIVATE_KEY, resendApiKey: process.env.RESEND_API_KEY,
      appUrl: process.env.NEXT_PUBLIC_APP_URL };
    const outcome = await dispatchOne(requested, notificationRepository(supabaseAdmin), config, notificationTransport(config));
    return NextResponse.json({ outcome }, { status: ['unavailable', 'unknown', 'blocked', 'rejected'].includes(outcome) ? 503 : 200 });
  } catch {
    return NextResponse.json({ error: 'Notification dispatch is unavailable' }, { status: 503 });
  }
}
