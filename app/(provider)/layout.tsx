/**
 * Provider Layout -- Server Component
 *
 * Fetches the authenticated user, their linked patient IDs, and
 * the urgent alert count, then wraps children in:
 *   1. QueryProvider (React Query client)
 *   2. RealtimeAlertsProvider (Supabase Realtime subscription)
 *   3. ProviderShell (sidebar + main content area, with urgentCount badge)
 *   4. Sonner Toaster (toast notifications)
 *
 * This ensures a SINGLE Realtime channel per provider session.
 *
 * Requirements: DASH-08 (realtime alert delivery), EFFI-02 (urgentCount badge)
 */

import { authorize } from '@/lib/auth/authorization';
import { getUrgentAlertCount } from '@/lib/dashboard/queries';
import { getLinkedPatientIds } from '@/lib/supabase/linked-patients';
import { redirect } from 'next/navigation';
import { Toaster } from 'sonner';
import { ProviderShell } from './_components/provider-shell';
import { QueryProvider } from './_components/query-provider';
import { RealtimeAlertsProvider } from './_components/realtime-alerts-provider';

export default async function ProviderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await authorize('provider');
  if (!auth.authorized) {
    redirect(
      auth.error === 'Consent required'
        ? '/consent'
        : auth.error === 'MFA required'
          ? '/security/mfa'
          : '/login',
    );
  }
  const supabase = auth.supabase;

  const providerId = auth.user.id;
  const [linkedPatientIds, urgentCount] = await Promise.all([
    getLinkedPatientIds(supabase, providerId).catch(() => null),
    getUrgentAlertCount(supabase, providerId).catch(() => null),
  ]);

  return (
    <QueryProvider>
      <RealtimeAlertsProvider
        providerId={providerId}
        linkedPatientIds={linkedPatientIds ?? []}
        linksAvailable={linkedPatientIds !== null}
      >
        <ProviderShell urgentCount={urgentCount}>{children}</ProviderShell>
        <Toaster richColors position="top-right" />
      </RealtimeAlertsProvider>
    </QueryProvider>
  );
}
