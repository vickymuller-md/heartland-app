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
import { getDailyLoop } from '@/lib/daily-loop/queries';
import { getRecentMessageDeliveries } from '@/lib/inbox/queries';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { ProductEventTracker } from '@/components/analytics/product-event-tracker';

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

  const [alertResult, operational, deliveries] = await Promise.all([
    getAlerts(supabase, user.id, statusFilter)
      .then((alerts) => ({ alerts, error: null as string | null }))
      .catch(() => ({ alerts: [], error: 'Alert query failed.' })),
    getDailyLoop(supabase, user.id),
    getRecentMessageDeliveries(supabase, user.id),
  ]);
  const workItems = Object.values(operational.sections).flat().slice(0, 8);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Operational Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Assigned work, patient alerts, and honest in-app message delivery evidence.
        </p>
      </div>

      <ProductEventTracker eventName="workspace_view" area="inbox" />

      <section className="space-y-3" aria-labelledby="inbox-work-title">
        <div className="flex items-center justify-between gap-3">
          <div><h2 id="inbox-work-title" className="text-lg font-bold text-slate-950">Assigned operational work</h2><p className="text-xs text-slate-600">First eight open items; manage the full queue in Daily Loop.</p></div>
          <Link href="/dashboard" className="text-sm font-medium text-blue-700 hover:underline">Open Daily Loop</Link>
        </div>
        {operational.error ? (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">{operational.error}</div>
        ) : workItems.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-slate-600">Assigned-work query loaded successfully and returned no open items.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workItems.map((item) => (
              <Link key={item.id} href={`/patients/${item.patient_id}`} className="rounded-lg border bg-white p-3 hover:border-blue-300">
                <div className="flex items-start justify-between gap-3"><span className="font-semibold text-slate-950">{item.patient_name}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${item.severity === 'critical' ? 'bg-red-100 text-red-800' : item.severity === 'warning' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>{item.severity}</span></div>
                <p className="mt-1 text-sm text-slate-800">{item.title}</p>
                <p className="mt-1 text-xs text-slate-500">{item.status} · {item.due_at ? formatDistanceToNow(new Date(item.due_at), { addSuffix: true }) : 'no deadline'}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="message-delivery-title">
        <div><h2 id="message-delivery-title" className="text-lg font-bold text-slate-950">Care-message delivery</h2><p className="text-xs text-slate-600">Available = persisted in the patient portal. Only “read” confirms portal review; no device delivery is implied.</p></div>
        {deliveries.error ? (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{deliveries.error}</div>
        ) : deliveries.messages.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-slate-600">No care messages sent yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-4 py-3">Patient</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Sent</th><th className="px-4 py-3">Evidence</th></tr></thead><tbody className="divide-y">{deliveries.messages.map((message) => (
              <tr key={message.id}><td className="px-4 py-3"><Link href={`/patients/${message.patient_id}`} className="font-medium text-blue-700 hover:underline">{message.patient_name}</Link></td><td className="px-4 py-3 text-slate-800">{message.subject}</td><td className="px-4 py-3 text-slate-600">{formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${message.delivery_state === 'read' ? 'bg-emerald-100 text-emerald-800' : message.delivery_state === 'failed' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>{message.delivery_state}</span></td></tr>
            ))}</tbody></table>
          </div>
        )}
      </section>

      {/* Status filter tabs */}
      <div><h2 className="mb-2 text-lg font-bold text-slate-950">Patient alerts</h2><nav className="flex gap-1 rounded-lg bg-muted p-1" aria-label="Alert status filter">
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
      </nav></div>

      {alertResult.error ? (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900">
          Alert inbox could not be loaded. Do not interpret this as an empty queue; use your facility escalation workflow and try again.
        </div>
      ) : (
        <AlertInbox alerts={alertResult.alerts} statusFilter={statusFilter} />
      )}
    </div>
  );
}
