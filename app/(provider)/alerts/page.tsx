/**
 * Alert Inbox Page -- Server Component
 *
 * Fetches alerts for the authenticated provider and renders
 * the alert inbox with status filtering via URL searchParams.
 *
 * Requirements: DASH-05 (alert inbox with resolution workflow)
 */

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getAlerts } from '@/lib/dashboard/queries';
import type { AlertStatus } from '@/lib/dashboard/types';
import { AlertInbox } from './_components/alert-inbox';

interface AlertsPageProps {
  searchParams: Promise<{ status?: string }>;
}

const VALID_STATUSES = ['all', 'open', 'acknowledged', 'resolved'] as const;

export default async function AlertsPage({ searchParams }: AlertsPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const params = await searchParams;
  const statusParam = params.status ?? 'open';
  const statusFilter = VALID_STATUSES.includes(
    statusParam as (typeof VALID_STATUSES)[number]
  )
    ? (statusParam as AlertStatus | 'all')
    : 'open';

  const alerts = await getAlerts(supabase, user.id, statusFilter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Alert Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Monitor patient alerts and take action on critical notifications.
        </p>
      </div>

      {/* Status filter tabs */}
      <nav className="flex gap-1 rounded-lg bg-muted p-1" aria-label="Alert status filter">
        {VALID_STATUSES.map((s) => {
          const isActive = s === statusFilter;
          const label = s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1);
          return (
            <a
              key={s}
              href={`/alerts?status=${s}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {label}
            </a>
          );
        })}
      </nav>

      <AlertInbox alerts={alerts} statusFilter={statusFilter} />
    </div>
  );
}
