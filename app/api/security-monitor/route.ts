import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

function validCronAuthorization(header: string | null, secret: string): boolean {
  const actual = Buffer.from(header ?? '', 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function verifiedMfaUserIds(): Promise<Set<string>> {
  const result = new Set<string>();
  const perPage = 1000;

  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    for (const user of data.users) {
      if (
        (user.factors ?? []).some(
          (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
        )
      ) {
        result.add(user.id);
      }
    }

    if (data.users.length < perPage) return result;
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[security-monitor] CRON_SECRET is not configured');
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
  if (!validCronAuthorization(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ status: 'error' }, { status: 401 });
  }

  try {
    const now = new Date();
    const reviewPeriod = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);

    const [providersResult, organizationsResult, reviewsResult, deliveriesResult, workResult, mfaIds] =
      await Promise.all([
        supabaseAdmin.from('profiles').select('id').eq('role', 'provider'),
        supabaseAdmin.from('organizations').select('id').eq('status', 'active'),
        supabaseAdmin
          .from('access_reviews')
          .select('organization_id')
          .eq('review_period', reviewPeriod),
        supabaseAdmin
          .from('notification_deliveries')
          .select('id', { count: 'exact', head: true })
          .eq('state', 'failed'),
        supabaseAdmin
          .from('work_items')
          .select('id', { count: 'exact', head: true })
          .neq('status', 'closed')
          .lt('due_at', now.toISOString()),
        verifiedMfaUserIds(),
      ]);

    const firstError = [
      providersResult.error,
      organizationsResult.error,
      reviewsResult.error,
      deliveriesResult.error,
      workResult.error,
    ].find(Boolean);
    if (firstError) throw firstError;

    const providerIds = (providersResult.data ?? []).map((provider) => provider.id);
    const providersWithVerifiedMfa = providerIds.filter((id) => mfaIds.has(id)).length;
    const reviewedOrganizations = new Set(
      (reviewsResult.data ?? []).map((review) => review.organization_id),
    );
    const organizationsWithoutReview = (organizationsResult.data ?? []).filter(
      (organization) => !reviewedOrganizations.has(organization.id),
    ).length;
    const failedDeliveryCount = deliveriesResult.count ?? 0;
    const overdueWorkItemCount = workResult.count ?? 0;
    const gateStatus =
      providersWithVerifiedMfa === providerIds.length &&
      organizationsWithoutReview === 0 &&
      failedDeliveryCount === 0
        ? 'pass'
        : 'degraded';

    const snapshot = {
      gate_status: gateStatus,
      provider_count: providerIds.length,
      providers_with_verified_mfa: providersWithVerifiedMfa,
      organizations_without_review: organizationsWithoutReview,
      failed_delivery_count: failedDeliveryCount,
      overdue_work_item_count: overdueWorkItemCount,
      captured_at: now.toISOString(),
    };
    const { error: insertError } = await supabaseAdmin
      .from('security_posture_snapshots')
      .insert(snapshot);
    if (insertError) throw insertError;

    if (gateStatus === 'degraded') {
      console.warn('[security-monitor] Security posture is degraded', snapshot);
    }

    return NextResponse.json({ status: gateStatus, timestamp: snapshot.captured_at });
  } catch {
    console.error('[security-monitor] Posture scan failed');
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
