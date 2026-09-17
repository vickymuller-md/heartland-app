import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

function validCronAuthorization(header: string | null, secret: string): boolean {
  const actual = Buffer.from(header ?? '', 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// The admin user listing does not expose MFA factors, so each provider is asked
// through the MFA admin API. Providers only: the count feeds the aggregate gate.
async function providersWithVerifiedTotp(providerIds: string[]): Promise<number> {
  let count = 0;
  for (const userId of providerIds) {
    const { data, error } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId });
    if (error) throw error;
    const verified = (data?.factors ?? []).some(
      (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
    );
    if (verified) count += 1;
  }
  return count;
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

    const providersResult = await supabaseAdmin.from('profiles').select('id').eq('role', 'provider');
    if (providersResult.error) throw providersResult.error;
    const providerIds = (providersResult.data ?? []).map((provider) => provider.id);

    const [organizationsResult, reviewsResult, deliveriesResult, workResult, providersWithVerifiedMfa] =
      await Promise.all([
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
        providersWithVerifiedTotp(providerIds),
      ]);

    const firstError = [
      organizationsResult.error,
      reviewsResult.error,
      deliveriesResult.error,
      workResult.error,
    ].find(Boolean);
    if (firstError) throw firstError;

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
