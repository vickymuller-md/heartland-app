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

import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Toaster } from 'sonner';
import { ProviderShell } from './_components/provider-shell';
import { QueryProvider } from './_components/query-provider';
import { RealtimeAlertsProvider } from './_components/realtime-alerts-provider';

/** Count open critical/warning alerts for the provider's linked patients (EFFI-02). */
async function getUrgentAlertCount(
  supabase: SupabaseClient,
  patientIds: string[],
): Promise<number> {
  if (patientIds.length === 0) return 0;

  const { count } = await supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .in('patient_id', patientIds)
    .in('severity', ['critical', 'warning'])
    .eq('status', 'open');

  return count ?? 0;
}

export default async function ProviderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch linked patient IDs for Realtime subscription filtering
  let linkedPatientIds: string[] = [];
  const providerId = user?.id ?? '';

  if (user) {
    const { data: links } = await supabase
      .from('provider_patient_links')
      .select('patient_id')
      .eq('provider_id', user.id)
      .eq('status', 'active');

    linkedPatientIds = (links ?? []).map((l) => l.patient_id);
  }

  // Fetch urgent alert count for sidebar badge (EFFI-02)
  const urgentCount = linkedPatientIds.length > 0
    ? await getUrgentAlertCount(supabase, linkedPatientIds)
    : 0;

  return (
    <QueryProvider>
      <RealtimeAlertsProvider
        providerId={providerId}
        linkedPatientIds={linkedPatientIds}
      >
        <ProviderShell urgentCount={urgentCount}>{children}</ProviderShell>
        <Toaster richColors position="top-right" />
      </RealtimeAlertsProvider>
    </QueryProvider>
  );
}
